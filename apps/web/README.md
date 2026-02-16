# CameraLab Web MVP (`T0-T8`)

This folder contains the initial web MVP with:

- Vite + TypeScript bootstrap
- Split layout: left control panel + right canvas preview
- WebGL2 fullscreen quad renderer for an uploaded image texture
- Image loading via file input and drag & drop
- Webcam input via `getUserMedia`
- Source toggle (image/webcam)
- Parameter state store with change listeners
- Camera sliders + numeric readouts
- Presets (Portrait / Landscape / Night)
- Preview modes: A / B / Split + split slider
- Multi-pass WebGL pipeline (`input -> lens -> effects -> composite`)
- RGB histogram panel (CPU readback, ~200ms interval)
- Keyboard shortcuts: `Space` (A/B), `S` (split), `R` (reset)
- PNG snapshot export
- Custom preset save/load (localStorage)
- Histogram source mode selector (Original / Processed / Composite)
- Session state restore on reload (localStorage)
- Camera color controls: white balance (temp/tint), contrast, saturation
- Upscaling controls: 1x / 1.5x / 2x / 2.5x / 3x / 3.5x / 4x internal processing + scaled PNG export
- Tap-to-meter Auto Exposure / Auto Focus with AE/AF lock toggle
- Sharpen and ISO-aware Noise Reduction controls
- Performance modes: Quality / Balanced / Fast (preview resolution scaling, high-quality snapshot export)
- Parameter UI theme switch: `Sliders` or camera-style `Dials`

Not included yet:

- Additional UI polish and camera-body styling

## Run

```bash
cd apps/web
npm install
npm run dev
```

Open `http://localhost:5173`.
When selecting `Webcam`, allow camera permission in your browser.

## Other commands

```bash
cd apps/web
npm run typecheck
npm run build
npm run preview
```

## File organization

- App/UI logic: `src/app/*`
- WebGL renderer: `src/app/gl/*`
