# CameraLab Web MVP (`T0-T2`)

This folder contains the initial web MVP with:

- Vite + TypeScript bootstrap
- Split layout: left control panel + right canvas preview
- WebGL2 fullscreen quad renderer for an uploaded image texture
- Image loading via file input and drag & drop

Not included yet:

- Webcam capture
- Effects pipeline
- Multi-pass rendering

## Run

```bash
cd apps/web
npm install
npm run dev
```

Open `http://localhost:5173`.

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

