# CameraLab Web (MVP) — CODEX.md

## Goal
Build a serverless web app that teaches camera controls by simulating camera/lens/sensor effects in real time.
Inputs: (1) image upload (single still), (2) webcam stream.
UI: left "camera body" control panel + right preview (before/after + split).
Tech: Vite + TypeScript + WebGL2 (GLSL). No backend.

## Non-goals (MVP)
- No account/login, no server storage
- No photoreal physically-based ray tracing
- No full RAW pipeline (we approximate linear space)
- No heavy ML features

## Definition of Done (MVP)
- App runs locally with `pnpm dev` (or npm) and builds with `pnpm build`
- Image upload works + webcam input works
- Real-time controls:
  - Exposure (EV), Shutter (motion blur intensity), ISO (noise), Aperture (DoF strength)
  - Focal length / FOV, Distortion, Vignette
  - Tone mapping on/off (simple filmic)
- Preview modes:
  - A/B toggle
  - Split view slider
- Histogram panel (RGB histogram; approximate ok)
- Presets: Portrait / Landscape / Night (set multiple params)

## Repo Structure
camera-lab/
  apps/web/
    index.html
    vite.config.ts
    src/
      main.ts
      app/App.ts
      app/state.ts
      app/ui/
      app/gl/
      assets/
  packages/core/
    src/
      cameraModel.ts
      presets.ts
      types.ts
  packages/shaders/
    src/
      fullscreen.vert.glsl
      pipeline/
        pass_input.frag.glsl
        pass_lens.frag.glsl
        pass_effects.frag.glsl
        pass_hist.frag.glsl
      utils/
        color.glsl
        noise.glsl
        sampling.glsl

Monorepo is optional for MVP. If too heavy, collapse into apps/web only, but keep folder names for future split.

## Build & Run
- Use Vite (no React required). Minimal DOM + TS modules.
- Use WebGL2 only.
Commands:
- `pnpm i` (or npm i)
- `pnpm -C apps/web dev`
- `pnpm -C apps/web build`
- `pnpm -C apps/web preview`

## Coding Rules
- TypeScript strict
- No external heavy frameworks unless needed (avoid React for MVP speed)
- Keep GPU pipeline in `src/app/gl/`
- All parameters stored in a single state object with change listeners
- Shader uniforms updated per-frame
- Avoid allocations in render loop

## Milestones / Tickets

### T0 — Project bootstrap
- Create Vite TS project in `apps/web`
- Add minimal page layout: left panel, right preview
- Add basic CSS grid: left fixed width, right flexible

### T1 — WebGL2 fullscreen quad renderer
- Initialize WebGL2 context on canvas
- Compile shader utilities (compile, link, uniform setter)
- Render an image texture to screen (no effects)

### T2 — Image input
- File input + drag/drop
- Load into HTMLImageElement -> WebGL texture
- Maintain aspect ratio fit/contain

### T3 — Webcam input
- getUserMedia video
- Update texture per frame using `texSubImage2D`
- Toggle image/webcam source

### T4 — Parameter system + UI sliders
Params (with sane defaults):
- exposureEV: -3..+3
- shutter: 1/8000..1/15 (represent as log scale, mapped to blur strength)
- iso: 100..6400 (noise strength)
- aperture: f/1.4..f/22 (DoF strength)
- focalLength: 18..120 (affects FOV)
- focusDistance: 0.2..50 (affects DoF)
- distortion: -0.5..+0.5
- vignette: 0..1
- chromaAberration: 0..1 (optional)
- toneMap: boolean

UI:
- Sliders + numeric readout
- Preset dropdown buttons
- A/B toggle, split slider

### T5 — Shader pipeline (multi-pass)
We do ping-pong FBO passes:
1) pass_input: linearize + exposure
2) pass_lens: distortion + vignette + slight CA (optional)
3) pass_effects: noise + motion blur approx + DoF approx + tone map
4) pass_hist: histogram data (downsample or compute on CPU fallback)

Implement minimal ping-pong helper.

### T6 — A/B and Split View
- Keep "original" texture path and "processed" path
- A/B toggle: show either
- Split: draw both with slider (can be in final composite shader)

### T7 — Histogram
Option A: GPU reduction (advanced) — optional
Option B (MVP): CPU histogram from a downscaled canvas readback (e.g., 256x256) once per 200ms.
Implement B for MVP.

### T8 — Polish
- Camera body SVG UI (optional), but at least clean panel styling
- Presets
- Keyboard shortcuts:
  - space: A/B
  - s: split toggle
  - r: reset

## Technical Notes (Implementation Hints)
- Use linear color for effects:
  - decode: `pow(color, 2.2)` approx
  - encode: `pow(color, 1.0/2.2)`
- Exposure: multiply by `2^exposureEV`
- Noise:
  - luminance-dependent noise: `noise * (1 + k*brightness)`
- Distortion: radial k1
- Vignette: smoothstep on radius
- DoF approx:
  - compute circle-of-confusion from focusDistance & aperture (approx)
  - blur radius small (0..8 px) using 9-tap sampling
- Motion blur approx:
  - use previous frame accumulation for webcam only
  - keep last N frames in textures? (MVP: simple mix with prevFrame)
