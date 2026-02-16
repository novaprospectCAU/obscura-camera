# CameraLab Web MVP (`T0-T7`)

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

Not included yet:

- Keyboard shortcuts polish

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
