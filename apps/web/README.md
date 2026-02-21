# CameraLab Web

CameraLab Web is an interactive camera-look simulator.
It is built for teaching and experimentation, not physically exact RAW reproduction.

## Core Behavior

- Source: uploaded image or webcam
- Preview modes:
  - `A`: Original source
  - `B`: Processed simulation
  - `Split`: A/B comparison
- Rendering pipeline: `input -> lens -> effects -> composite`
- Histogram modes: `Original / Processed / Composite`

## Important Limitation

`Processed (B)` is intentionally non-bypass simulation.
Even with conservative settings, it may not be pixel-identical to the source due to shader passes and texture sampling.

If you need the closest original view, use preview `A (Original)`.

## Current Feature Set

- Vite + TypeScript + WebGL2 renderer
- Drag/drop image loading + file picker + webcam input
- Camera control set:
  - exposure, shutter, ISO, aperture, focal length, focus distance
  - distortion, vignette, chromatic aberration
  - white balance (temp/tint), contrast, saturation
  - sharpen + noise reduction
- Lens/subject tools:
  - interaction modes: `AE/AF`, `Subject Select`, `Screen Pan`
  - marker tools: `Focus Lens`, `Blur Lens`, `Natural Light`, `Artificial Light`
  - undo/redo history for marker edits
- Snapshot export (`PNG`)
- Upscaling controls:
  - factor: `1x / 1.5x / 2x / 2.5x / 3x / 3.5x / 4x`
  - style: `Balanced` / `Enhanced`
  - preview performance scale: `Quality / Balanced / Fast`
- AI prompt adjustment with subject-aware context

## Reset and "Original-Reference" Baseline

`Reset` (button or `R`) restores baseline parameters and re-creates one `Focus Lens` marker at detected subject center.

Current baseline defaults:

- Exposure: `0.00`
- Shutter: `1/8000`
- ISO: `100`
- Aperture: `f/22.0`
- Focal Length: `18mm`
- Focus Distance: `50.0m`
- Distortion / Vignette / Chromatic Aberration: `0`
- Temp / Tint: `0`
- Contrast / Saturation: `1`
- Sharpen: `0`
- Noise Reduction: `0.8`
- Tone Map: `off`
- Upscale: `1x`, style `Balanced`

## AI Prompt Shortcut for Original Restore

If the prompt intent is "restore to original/default" (for example, `원본으로 되돌려줘`, `restore original`, `reset to default`), the app applies local reset logic directly instead of sending a style-tuning request.

## Run

```bash
cd apps/web
npm install
npm run dev
```

Open `http://localhost:5173`.
When using webcam mode, allow camera permission in your browser.

## Commands

```bash
cd apps/web
npm run typecheck
npm run build
npm run preview
```

## Keyboard Shortcuts

- `Space`: toggle A/B
- `S`: toggle Split
- `R`: reset to original-reference baseline
- `Cmd/Ctrl + Z`: undo
- `Cmd/Ctrl + Shift + Z` or `Cmd/Ctrl + Y`: redo
- `[` / `]`: decrease/increase selected marker size

## File Organization

- App/UI: `src/app/*`
- WebGL renderer: `src/app/gl/*`
