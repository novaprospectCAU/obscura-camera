# Obscura Camera

Obscura Camera is a browser-based camera learning lab.
It simulates camera/lens/sensor controls in real time with a WebGL pipeline, so you can compare:

<img width="1471" height="823" alt="image" src="https://github.com/user-attachments/assets/1b8dc94d-35d7-4424-9d9b-48a349d94241" />
<img width="1463" height="809" alt="image" src="https://github.com/user-attachments/assets/b676015d-f8be-48c2-8a74-8f264a1af2fe" />
<img width="1464" height="771" alt="image" src="https://github.com/user-attachments/assets/1ac273b6-6209-4914-995b-e44f7f67ecee" />

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
