# Obscura Camera

Obscura Camera is a browser-based camera learning lab.
It simulates camera/lens/sensor controls in real time with a WebGL pipeline, so you can compare:

- `A`: original input
- `B`: processed simulation
- `Split`: side-by-side comparison

Current implementation target is `apps/web`.

## What This Is

- Educational camera look simulator (not a RAW-accurate editor)
- Input sources: image upload or webcam
- Live controls for exposure, shutter, ISO, aperture, focus distance, lens effects, color, sharpening/NR
- Subject-aware interaction with focus/blur/light markers
- AI prompt assistance for look tuning

## Important Note

`Processed (B)` is intentionally a simulation path (`input -> lens -> effects -> composite`).
It is not designed to be bit-exact with the original file.
Use `A (Original)` when you need the closest unprocessed view.

## Run Locally

```bash
cd apps/web
npm install
npm run dev
```

Open `http://localhost:5173`.

## Build / Typecheck

```bash
cd apps/web
npm run typecheck
npm run build
npm run preview
```

## Deployment

This project is configured to auto-deploy from `main` to Vercel.

## Docs

- Web app details: `apps/web/README.md`
