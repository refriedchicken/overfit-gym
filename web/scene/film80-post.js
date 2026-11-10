// The film80 look's final pass: what a 35mm print of the frame would look like.
// Display-referred (runs after the output pass). Everything that moves (grain,
// gate weave, exposure flicker, dust) is a hash of the pixel and the 24 fps
// frame number derived from scene time, so a capture frame is a pure function
// of (seed, t). `full` = 0 keeps only the print colour and the grain (low tier).
import * as THREE from 'three';

export const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    dpr: { value: 1 },
    frame: { value: 0 },
    full: { value: 1 },
    grain: { value: 0.07 },
    vignette: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    precision highp int;
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float dpr;
    uniform float frame;
    uniform float full;
    uniform float grain;
    uniform float vignette;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    uint pcg(uint v) {
      uint s = v * 747796405u + 2891336453u;
      uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
      return (w >> 22u) ^ w;
    }
    uint hashU(ivec2 p, uint salt) { return pcg(uint(p.x) + pcg(uint(p.y) + pcg(uint(frame) * 7u + salt))); }
    /** three 10-bit values in -0.5..0.5 from one hash */
    vec3 hash3(ivec2 p, uint salt) {
      uint n = hashU(p, salt);
      return vec3(float(n & 1023u), float((n >> 10u) & 1023u), float((n >> 20u) & 1023u)) / 1023.0 - 0.5;
    }
    vec3 vnoise(vec2 p, uint salt) {
      ivec2 i = ivec2(floor(p));
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash3(i, salt), hash3(i + ivec2(1, 0), salt), f.x), mix(hash3(i + ivec2(0, 1), salt), hash3(i + ivec2(1, 1), salt), f.x), f.y);
    }
    /** per-frame scalars (no pixel term) */
    vec3 frameRand(uint salt) { return hash3(ivec2(0, 0), salt) + 0.5; }

    /** Print-film colour: crosstalk, olive greens, warm skin and wood, toe and shoulder, split tone, lifted warm blacks. */
    vec3 printFilm(vec3 c) {
      c = mat3(1.03, 0.02, 0.0, -0.01, 0.95, 0.03, -0.02, 0.03, 0.97) * c;
      c = max(c, 0.0);
      float l = luma(c);
      // greens lose saturation and lean olive
      float gd = max(0.0, c.g - max(c.r, c.b));
      c = mix(c, vec3(l), min(1.0, gd * 1.6));
      c.r += gd * 0.22;
      c.b -= gd * 0.05;
      // oranges (wood, brass, skin-ish paint) gain a little
      float warm = clamp((c.r - c.b) * 2.0, 0.0, 1.0) * clamp(1.0 - abs(c.g - mix(c.b, c.r, 0.55)) * 4.0, 0.0, 1.0);
      l = luma(c);
      c = mix(vec3(l), c, 0.9 + 0.3 * warm);
      // tone: a slightly crushed toe, an S, and a soft shoulder
      c = max(c - 0.012, 0.0) / 0.988;
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.34);
      c = c * 1.1 / (1.0 + 0.1 * c * c);
      c = pow(c, vec3(0.97, 1.0, 1.05));
      l = luma(c);
      c += vec3(-0.016, 0.01, 0.022) * (1.0 - smoothstep(0.0, 0.42, l)) + vec3(0.03, 0.012, -0.034) * smoothstep(0.5, 1.0, l);
      // print base: blacks never reach zero and lean warm, whites are a little creamy
      c = mix(vec3(0.048, 0.036, 0.031), vec3(0.985, 0.965, 0.925), clamp(c, 0.0, 1.0));
      return c;
    }

    void main() {
      vec2 uv = vUv;
      vec2 px = 1.0 / resolution;
      vec3 fr = frameRand(11u);
      // gate weave: the whole frame sits a fraction of a pixel differently each 24 fps frame
      uv += (fr.xy - 0.5) * vec2(0.5, 0.7) * dpr * px * full;
      vec2 d = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
      float r2 = dot(d, d);
      vec3 c;
      if (full > 0.5) {
        // lens: lateral chromatic aberration and softness that both grow toward the corners
        vec2 dir = (uv - 0.5);
        vec2 ca = dir * r2 * 2.6 * dpr * px;
        c.r = texture2D(tDiffuse, uv + ca).r;
        c.g = texture2D(tDiffuse, uv).g;
        c.b = texture2D(tDiffuse, uv - ca).b;
        float soft = smoothstep(0.12, 0.9, r2);
        vec2 o = px * dpr * (0.6 + 1.3 * soft);
        vec3 b = texture2D(tDiffuse, uv + o).rgb + texture2D(tDiffuse, uv - o).rgb + texture2D(tDiffuse, uv + vec2(o.x, -o.y)).rgb + texture2D(tDiffuse, uv + vec2(-o.x, o.y)).rgb;
        c = mix(c, b * 0.25, 0.22 + 0.5 * soft);
      } else {
        c = texture2D(tDiffuse, uv).rgb;
      }
      c = printFilm(c);
      // exposure breathing: under one percent, per 24 fps frame
      c *= 1.0 + (fr.z - 0.5) * 0.014 * full;
      // vignette, a touch warm
      float v = smoothstep(0.3, 1.25, sqrt(r2) * 1.55);
      c *= 1.0 - vignette * v;
      c = mix(c, c * vec3(1.03, 0.99, 0.93), v * 0.6);

      // grain: fine + clumped octaves, a little chroma, strongest in the mids and shadows
      vec2 gp = gl_FragCoord.xy / dpr;
      vec3 g = hash3(ivec2(gp * 1.0), 1u) * 0.55 + vnoise(gp * 0.62, 2u) * 0.9 + vnoise(gp * 0.27, 3u) * 0.55;
      float gm = (g.r + g.g + g.b) / 3.0;
      g = mix(vec3(gm), g, 0.42);
      float l = luma(c);
      float w = (1.0 - 0.72 * smoothstep(0.35, 0.98, l)) * (0.55 + 0.45 * smoothstep(0.0, 0.1, l));
      c += g * grain * w * 2.0;

      if (full > 0.5) {
        // dust specks and the odd hairline scratch: sparse, one 24 fps frame each
        for (uint i = 0u; i < 2u; i++) {
          vec3 q = frameRand(31u + i);
          if (q.z > 0.955) {
            vec3 s = frameRand(41u + i);
            float rad = (0.8 + 2.2 * s.x) * dpr;
            vec2 e = (gl_FragCoord.xy - q.xy * resolution) * vec2(1.0, 0.6 + s.y);
            float m = 1.0 - smoothstep(rad * 0.4, rad, length(e));
            c = mix(c, s.z > 0.3 ? vec3(0.06, 0.05, 0.045) : vec3(0.93, 0.9, 0.84), m * 0.75);
          }
        }
        vec3 sc = frameRand(51u);
        if (sc.z > 0.975) {
          float x = sc.x * resolution.x + sin(gl_FragCoord.y * 0.004 + sc.y * 6.0) * 2.0 * dpr;
          float m = 1.0 - smoothstep(0.0, 0.9 * dpr, abs(gl_FragCoord.x - x));
          float seg = step(sc.y * 0.6, vUv.y) * step(vUv.y, sc.y * 0.6 + 0.45);
          c += vec3(0.1, 0.095, 0.08) * m * seg;
        }
      }
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};
