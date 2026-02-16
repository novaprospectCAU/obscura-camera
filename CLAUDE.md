# CameraLab Web (MVP) — CLAUDE.md

## Purpose
We want an interactive teaching tool. The simulation must be:
- Intuitive (controls produce expected visual changes)
- Stable (no flicker, no extreme artifacts)
- Real-time (>= 30 fps on typical laptops)

We prioritize "educational plausibility" over perfect physical accuracy.

## Visual Model (MVP)

### Color Space
- Assume input is sRGB.
- Convert to linear for most math:
  - linear ≈ pow(srgb, 2.2)
- Apply exposure, blur, noise in linear.
- Convert back to display (sRGB-ish):
  - srgb ≈ pow(linear, 1/2.2)
- Tone mapping (optional): simple filmic curve.

### Exposure (EV)
- Exposure multiplier:
  - m = 2 ^ exposureEV
- Apply in linear: `color *= m`
- Clamp before output, but avoid harsh clipping:
  - Use soft knee: `color = color / (1 + color)` or filmic.

### Lens: FOV & Distortion
- Focal length -> FOV:
  - For educational purposes, map focalLength to FOV directly.
  - Example: FOVdeg = clamp( 2 * atan(sensorWidth/(2*focalLength)) )
  - But we can approximate: `fov = mix(90, 20, normalizedFocal)`
- Distortion: radial k1
  - p = uv*2-1
  - r2 = dot(p,p)
  - p' = p * (1 + k1*r2)
  - uv' = (p' + 1)/2

### Vignette
- r = length(p)
- vignette = smoothstep(1.0, 0.2, r) or customizable
- color *= mix(1, vignette, vignetteStrength)

### ISO Noise (Educational)
Higher ISO => more noise, less usable dynamic range.
Model:
- noiseSigma = base * sqrt(iso/100)
- Add:
  - gaussian noise
  - optionally small chroma noise
- Add mild highlight compression to simulate reduced DR:
  - apply tone map stronger at high ISO

### Shutter & Motion Blur (MVP)
- For still image: "blur strength" slider to mimic long exposure.
- For webcam: temporal accumulation:
  - out = mix(current, prev, alpha) where alpha depends on shutter
  - Keep prev frame texture (ping-pong)
This isn’t physically exact but teaches the concept.

### Aperture & Depth of Field (MVP)
True DoF requires depth. We don’t have depth from a single image.
Educational approximation options:
1) **Radial focus** (default):
   - assume focus at center; blur increases toward edges
   - good for concept demonstration
2) **User focus point** (better):
   - click to set focus center; blur based on distance from that point
We should implement #2 if possible, otherwise #1.

Blur kernel:
- 9-tap or 13-tap Poisson disk
- blurRadius = map(aperture, focusDistance) to 0..8 px

### Chromatic Aberration (Optional)
Sample R/G/B at slightly different UV offsets proportional to radius.

## UX Requirements
- Immediate feedback: any slider change must affect frame within 1 frame.
- Presets must be meaningful:
  - Portrait: wide aperture, mild vignette, focal longer, slight warmth
  - Landscape: narrow aperture, wide FOV, low ISO
  - Night: high ISO, long shutter (more blur), strong tone mapping

## Validation Scenarios (Manual QA)
1) Exposure EV:
- EV +2 should look ~4x brighter
- Highlights compress, shadows lift

2) ISO:
- ISO 100: nearly clean
- ISO 3200: visible noise in shadows, slight highlight roll-off

3) Distortion:
- Distortion +0.3: barrel (edges bulge outward)
- Distortion -0.3: pincushion (edges pinch inward)

4) Vignette:
- Strength 1.0: corners clearly darker

5) Motion blur:
- On webcam: waving hand should smear more at slower shutter
- On still image: blur slider should soften edges

6) DoF:
- With user focus point: click near subject -> subject clearer than background region

7) Performance:
- 1080p webcam should remain workable.
- If too slow, downscale internal processing resolution (e.g., 0.75x).

## Implementation Priority
1) Exposure + Tone map
2) Distortion + Vignette
3) ISO noise
4) Webcam temporal blur
5) DoF approximation + focus pick
6) Histogram + presets

## Notes for AI Agent Collaboration
- Claude: if an effect looks wrong, propose a simpler model first.
- Codex: implement with minimal code churn; keep shaders modular.
- Always keep a "bypass" path to compare original vs processed.
