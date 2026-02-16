export type PreviewMode = "original" | "processed" | "split";
export type HistogramMode = "original" | "processed" | "composite";
export type UpscaleFactor = 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4;

export type CameraParams = {
  exposureEV: number;
  shutter: number;
  iso: number;
  aperture: number;
  focalLength: number;
  focusDistance: number;
  distortion: number;
  vignette: number;
  chromaAberration: number;
  temperature: number;
  tint: number;
  contrast: number;
  saturation: number;
  sharpen: number;
  noiseReduction: number;
  toneMap: boolean;
  upscaleFactor: UpscaleFactor;
  previewScale: number;
  previewMode: PreviewMode;
  splitPosition: number;
  histogramMode: HistogramMode;
};

export const DEFAULT_CAMERA_PARAMS: CameraParams = {
  exposureEV: 0,
  shutter: 1 / 8000,
  iso: 100,
  aperture: 1.4,
  focalLength: 18,
  focusDistance: 4,
  distortion: 0,
  vignette: 0,
  chromaAberration: 0,
  temperature: 0,
  tint: 0,
  contrast: 1,
  saturation: 1,
  sharpen: 0.22,
  noiseReduction: 0.15,
  toneMap: false,
  upscaleFactor: 1,
  previewScale: 1,
  previewMode: "processed",
  splitPosition: 0.5,
  histogramMode: "composite"
};

export type CameraPresetName = "Portrait" | "Landscape" | "Night";

export const CAMERA_PRESETS: Record<CameraPresetName, Partial<CameraParams>> = {
  Portrait: {
    exposureEV: 0.2,
    shutter: 1 / 200,
    iso: 200,
    aperture: 2.2,
    focalLength: 85,
    focusDistance: 1.6,
    distortion: -0.04,
    vignette: 0.32,
    chromaAberration: 0.08,
    temperature: 0.12,
    contrast: 1.04,
    saturation: 1.06,
    sharpen: 0.28,
    noiseReduction: 0.1
  },
  Landscape: {
    exposureEV: -0.1,
    shutter: 1 / 320,
    iso: 100,
    aperture: 11,
    focalLength: 28,
    focusDistance: 25,
    distortion: 0.05,
    vignette: 0.18,
    chromaAberration: 0.03,
    temperature: -0.04,
    contrast: 1.08,
    saturation: 1.18,
    sharpen: 0.35,
    noiseReduction: 0.08
  },
  Night: {
    exposureEV: 1.2,
    shutter: 1 / 30,
    iso: 2500,
    aperture: 1.8,
    focalLength: 35,
    focusDistance: 5,
    distortion: 0,
    vignette: 0.4,
    chromaAberration: 0.12,
    temperature: -0.08,
    tint: 0.04,
    contrast: 0.93,
    saturation: 0.88,
    sharpen: 0.14,
    noiseReduction: 0.38
  }
};

type StateListener = (state: Readonly<CameraParams>) => void;

export class CameraParamStore {
  private state: CameraParams;
  private readonly listeners = new Set<StateListener>();

  constructor(initialState: CameraParams = DEFAULT_CAMERA_PARAMS) {
    this.state = { ...initialState };
  }

  getState(): Readonly<CameraParams> {
    return this.state;
  }

  set<K extends keyof CameraParams>(key: K, value: CameraParams[K]): void {
    if (Object.is(this.state[key], value)) {
      return;
    }

    this.state = {
      ...this.state,
      [key]: value
    };
    this.emit();
  }

  patch(partial: Partial<CameraParams>): void {
    let changed = false;
    const nextState: CameraParams = {
      ...this.state,
      ...partial
    };

    for (const key of Object.keys(nextState) as Array<keyof CameraParams>) {
      if (!Object.is(nextState[key], this.state[key])) {
        changed = true;
        break;
      }
    }

    if (!changed) {
      return;
    }

    this.state = nextState;
    this.emit();
  }

  reset(): void {
    this.state = { ...DEFAULT_CAMERA_PARAMS };
    this.emit();
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
