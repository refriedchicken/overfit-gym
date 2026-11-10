# Third-party software

| Component | Version | License | Location | Notes |
|---|---|---|---|---|
| three.js | 0.184.0 | MIT | `web/vendor/three/` | Unmodified `build/three.module.min.js` and `build/three.core.min.js`. License text in `web/vendor/three/LICENSE`. |
| three.js add-ons (examples/jsm) | 0.184.0 | MIT | `web/vendor/three/addons/` | Unmodified post-processing passes (EffectComposer, GTAO, bloom, SMAA, bokeh, output), shaders, RoomEnvironment, RoundedBoxGeometry, BufferGeometryUtils, SimplexNoise. Same license as three.js. |
| Barlow Condensed (Medium, Bold, ExtraBold, Black) | 2017 | SIL OFL 1.1 | `web/fonts/` | Latin subsets in WOFF2, made with fontTools; glyphs unmodified. License in `web/fonts/OFL.txt`. |
| JetBrains Mono (variable) | 2020 | SIL OFL 1.1 | `web/fonts/` | Latin subset in WOFF2, made with fontTools; glyphs unmodified. License in `web/fonts/OFL.txt`. |

No third-party art, models, textures or audio are bundled. All 3D geometry and textures are generated
procedurally in `web/scene/`.

Nothing here is installed from a package registry: there are no runtime or development dependencies.
