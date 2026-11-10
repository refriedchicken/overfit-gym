// Post-processing for the gym: soft ambient occlusion, a restrained bloom that
// only catches screens, neon and sun glints, a warm/cool colour grade with a
// vignette, and a depth of field that switches itself on for close-ups.
//
// Quality tiers (?quality=low|medium|high; default high):
//   low     direct render, canvas MSAA, no post passes, pixel ratio 1
//   medium  MSAA scene target -> bloom -> output -> grade + vignette, pixel ratio <= 1.5
//   high    MSAA scene target -> GTAO -> bloom -> close-up DOF -> output -> grade + vignette, pixel ratio <= 2
// Without an explicit ?quality, a slow frame rate steps the tier down (never back up).
// Capture mode (?capture=1) never adapts and never reads a clock, so a frame is a
// pure function of the scene and camera.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { setBoost } from './materials.js';
import { LOOK } from '../look.js';
import { FilmShader } from './film80-post.js';

// The film80 look ("a 1980s gym shot on 35mm") keeps every tier on the composer:
//   low     scene -> output -> film (print colour + grain only)
//   medium  + pro-mist bloom, red halation, gate weave, lens softness, dust
//   high    + GTAO and close-up DOF
const F80 = LOOK === 'film80';

const TIERS = ['low', 'medium', 'high'];
const MAX_DPR = { low: 1, medium: 1.5, high: 2 };

/** Warm highlights, slightly cool shadows, gentle saturation and contrast, vignette, dither. Display-referred. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    shadowTint: { value: new THREE.Vector3(-0.014, -0.002, 0.022) },
    highTint: { value: new THREE.Vector3(0.026, 0.01, -0.02) },
    saturation: { value: 1.04 },
    contrast: { value: 0.16 },
    vignette: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform vec3 shadowTint;
    uniform vec3 highTint;
    uniform float saturation;
    uniform float contrast;
    uniform float vignette;
    varying vec2 vUv;
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;
      float l = luma(c);
      c += shadowTint * (1.0 - smoothstep(0.0, 0.5, l)) + highTint * smoothstep(0.5, 1.0, l);
      c = clamp(c, 0.0, 1.0);
      c = mix(c, c * c * (3.0 - 2.0 * c), contrast);
      l = luma(c);
      c = mix(vec3(l), c, saturation);
      vec2 d = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
      float v = smoothstep(0.42, 1.15, length(d));
      c *= 1.0 - vignette * v;
      c = mix(c, c * vec3(1.02, 0.99, 0.95), v * 0.6);
      // ordered (screen-position) dither: no time input, so frames stay reproducible
      float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      c += (n - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }`,
};

/** Replace NaN/Inf and clamp fireflies before bloom spreads them across the frame. */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null }, maxValue: { value: 3.2 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float maxValue;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, maxValue), clamp(c.a, 0.0, 1.0));
    }`,
};

/** Gather depth of field that reads the GTAO depth buffer (no extra scene render). */
const DofShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    focus: { value: 10 },
    near: { value: 2 },
    far: { value: 8 },
    maxBlur: { value: 6 },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 200 },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform float focus;
    uniform float near;
    uniform float far;
    uniform float maxBlur;
    uniform float cameraNear;
    uniform float cameraFar;
    varying vec2 vUv;
    float viewDist(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
    float coc(float z) { return smoothstep(near, far, abs(z - focus)); }
    void main() {
      float z = viewDist(vUv);
      float c0 = coc(z);
      vec4 base = texture2D(tDiffuse, vUv);
      if (c0 < 0.01) { gl_FragColor = base; return; }
      vec4 sum = base;
      float wsum = 1.0;
      for (int i = 0; i < 24; i++) {
        float fi = float(i) + 0.5;
        float r = sqrt(fi / 24.0);
        float a = fi * 2.39996323;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r * c0 * maxBlur / resolution;
        float sz = viewDist(uv);
        float w = sz < z ? coc(sz) : 1.0;
        sum += texture2D(tDiffuse, uv) * w;
        wsum += w;
      }
      gl_FragColor = sum / wsum;
    }`,
};

/** Deterministic replacement for GTAOPass's Math.random simplex denoise noise. */
function seededNoise(size = 64) {
  let s = 0x2f6b1d;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function readParams() {
  const p = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  const q = p.get('quality');
  return { capture: p.get('capture') === '1', quality: TIERS.includes(q) ? q : null };
}

/**
 * createPost(renderer, scene, camera) -> { render(), setSize(w, h), setFocus(d|null), quality, info() }
 */
export function createPost(renderer, scene, camera) {
  const { capture, quality: pinned } = readParams();
  let tier = pinned ?? 'high';
  let width = 1;
  let height = 1;
  let focusOverride = null;
  let autoFocus = null;

  const dpr = () => Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, MAX_DPR[tier]);
  renderer.setPixelRatio(dpr());

  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.pdNoiseTexture.dispose();
  gtao.pdNoiseTexture = seededNoise();
  gtao.pdMaterial.uniforms.tNoise.value = gtao.pdNoiseTexture;
  gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 9, radiusExponent: 1, rings: 3, samples: 24 });
  gtao.blendIntensity = 0.8;
  // glass, light shafts, decals and other see-through surfaces must not occlude
  const hideFromAO = gtao._overrideVisibility.bind(gtao);
  gtao._overrideVisibility = function () {
    hideFromAO();
    const cache = this._visibilityCache;
    scene.traverse((o) => {
      if (o.visible && o.isMesh && (o.material.transparent || o.userData.noAO || o.material.colorWrite === false)) {
        o.visible = false;
        cache.push(o);
      }
    });
  };
  // AO at CSS-pixel resolution, not device resolution: soft by nature, so this costs nothing visible
  const gtaoSetSize = gtao.setSize.bind(gtao);
  gtao.setSize = (w, h) => {
    const k = 1 / renderer.getPixelRatio();
    gtaoSetSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  };
  composer.addPass(gtao);

  const sanitize = new ShaderPass(SanitizeShader);
  composer.addPass(sanitize);

  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.4, 2.0);
  bloom.highPassUniforms.smoothWidth.value = 0.4;
  composer.addPass(bloom);
  // film80: the bloom becomes a wide, soft pro-mist veil, and a second, tight,
  // red-orange bloom stands in for halation (light scattering back through the film base)
  let halo = null;
  if (F80) {
    bloom.threshold = 0.82;
    bloom.strength = 0.13;
    bloom.radius = 0.9;
    bloom.highPassUniforms.smoothWidth.value = 0.5;
    bloom.compositeMaterial.uniforms.bloomFactors.value = [0.5, 0.7, 0.9, 1.0, 1.0];
    bloom.bloomTintColors.forEach((c) => c.set(1.0, 0.94, 0.86));
    halo = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.2, 1.15);
    halo.highPassUniforms.smoothWidth.value = 0.35;
    halo.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.9, 0.45, 0.0, 0.0];
    halo.bloomTintColors.forEach((c) => c.set(1.0, 0.24, 0.07));
    composer.addPass(halo);
  }

  const dof = new ShaderPass(DofShader);
  dof.enabled = false;
  composer.addPass(dof);

  composer.addPass(new OutputPass());
  const grade = new ShaderPass(F80 ? FilmShader : GradeShader);
  composer.addPass(grade);

  function applyTier() {
    setBoost(F80 || tier !== 'low');
    gtao.enabled = tier === 'high';
    bloom.enabled = tier !== 'low';
    if (halo) halo.enabled = tier !== 'low';
    if (F80) grade.uniforms.full.value = tier === 'low' ? 0 : 1;
    renderer.setPixelRatio(dpr());
    composer.setPixelRatio(dpr());
    setSize(width, height);
  }

  function setSize(w, h) {
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    const pw = w * renderer.getPixelRatio();
    const ph = h * renderer.getPixelRatio();
    grade.uniforms.resolution.value.set(pw, ph);
    if (F80) grade.uniforms.dpr.value = renderer.getPixelRatio();
    dof.uniforms.resolution.value.set(pw, ph);
  }

  // ---------- close-up depth of field, derived from the camera alone ----------
  const dir = new THREE.Vector3();
  function focusDistance() {
    if (focusOverride !== null) return focusOverride;
    // the world's autofocus (the robot in the middle of the frame) beats the floor-plane guess
    if (autoFocus !== null) return autoFocus;
    camera.getWorldDirection(dir);
    // distance along the view ray to chest height: the director aims there for close-ups
    if (dir.y > -0.05) return null;
    return (camera.position.y - 1.0) / -dir.y;
  }
  function updateDof() {
    const d = tier === 'high' ? focusDistance() : null;
    // fades in below ~15 m (focus and low shots) and is off for the wide shot
    const amount = d === null ? 0 : 1 - THREE.MathUtils.smoothstep(d, 11, 16);
    dof.enabled = amount > 0.02;
    if (!dof.enabled) return;
    const u = dof.uniforms;
    u.tDepth.value = gtao.depthTexture;
    u.focus.value = d;
    u.near.value = d * 0.22;
    u.far.value = d * 0.9;
    u.maxBlur.value = (height * renderer.getPixelRatio() * 0.0075) * amount;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
  }

  // ---------- adaptive quality (live only) ----------
  // Frame pacing comes from requestAnimationFrame timestamps, never from a clock read
  // in the render path, and the monitor does not exist at all in capture mode.
  // One decision, made once: skip a warm-up (shader compiles, texture uploads), measure
  // 150 frames, step down at most once (or twice if very slow), then stop for good.
  // Passes never flip back and forth, so the picture never pops after the first seconds.
  if (!capture && !pinned && typeof requestAnimationFrame === 'function') {
    const samples = [];
    let last = 0;
    let frames = 0;
    const tick = (t) => {
      if (last && t - last < 250) samples.push(t - last); // ignore stalls (tab switches)
      last = t;
      if (++frames < 90 || samples.length < 150) return requestAnimationFrame(tick);
      const sorted = [...samples].sort((x, y) => x - y);
      const median = sorted[sorted.length >> 1];
      const drop = median > 45 ? 2 : median > 24 ? 1 : 0;
      if (drop) {
        tier = TIERS[Math.max(0, TIERS.indexOf(tier) - drop)];
        applyTier();
      }
    };
    requestAnimationFrame(tick);
  }

  let calls = 0;
  let triangles = 0;
  renderer.info.autoReset = false;

  return {
    get quality() {
      return tier;
    },
    get capture() {
      return capture;
    },
    setSize,
    setFocus(d) {
      focusOverride = Number.isFinite(d) ? d : null;
    },
    /** Distance to the subject the camera is looking at, or null when there is none (the world sets this every frame). */
    setAutoFocus(d) {
      autoFocus = Number.isFinite(d) ? d : null;
    },
    /** Scene time in ms. The film look steps its grain, weave and dust on it at 24 fps; never a wall clock. */
    setTime(now) {
      if (F80) grade.uniforms.frame.value = Math.floor(((Number.isFinite(now) ? now : 0) * 24) / 1000) % 1048576;
    },
    render() {
      renderer.info.reset();
      if (tier === 'low' && !F80) renderer.render(scene, camera);
      else {
        updateDof();
        composer.render(0); // explicit delta: the composer timer is never read
      }
      calls = renderer.info.render.calls;
      triangles = renderer.info.render.triangles;
    },
    info() {
      return { quality: tier, calls, triangles, pixelRatio: renderer.getPixelRatio(), dof: dof.enabled, programs: renderer.info.programs?.length ?? 0 };
    },
    init() {
      applyTier();
    },
  };
}
