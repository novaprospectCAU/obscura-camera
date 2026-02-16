export type PreviewMode = "original" | "processed" | "split";
export type HistogramMode = "original" | "processed" | "composite";
export type UpscaleFactor = 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4;
export type UpscaleStyle = "balanced" | "enhanced";

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
  upscaleStyle: UpscaleStyle;
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
  upscaleStyle: "balanced",
  previewScale: 1,
  previewMode: "processed",
  splitPosition: 0.5,
  histogramMode: "composite"
};

export type CameraPresetName = "Portrait" | "Landscape" | "Night";

export const CAMERA_PRESETS: Record<CameraPresetName, Partial<CameraParams>> = {
  Portrait: {
    exposureEV: 0.15,
    shutter: 1 / 200,
    iso: 160,
    aperture: 2.0,
    focalLength: 85,
    focusDistance: 1.5,
    distortion: -0.03,
    vignette: 0.24,
    chromaAberration: 0.04,
    temperature: 0.1,
    tint: 0.02,
    contrast: 1.02,
    saturation: 1.07,
    sharpen: 0.3,
    noiseReduction: 0.12,
    toneMap: true,
    upscaleStyle: "balanced"
  },
  Landscape: {
    exposureEV: -0.2,
    shutter: 1 / 320,
    iso: 100,
    aperture: 11,
    focalLength: 28,
    focusDistance: 25,
    distortion: 0.04,
    vignette: 0.14,
    chromaAberration: 0.02,
    temperature: -0.05,
    tint: -0.02,
    contrast: 1.1,
    saturation: 1.2,
    sharpen: 0.42,
    noiseReduction: 0.06,
    toneMap: true,
    upscaleStyle: "enhanced"
  },
  Night: {
    exposureEV: 1.3,
    shutter: 1 / 20,
    iso: 3200,
    aperture: 1.8,
    focalLength: 35,
    focusDistance: 6,
    distortion: 0,
    vignette: 0.35,
    chromaAberration: 0.1,
    temperature: -0.1,
    tint: 0.06,
    contrast: 0.9,
    saturation: 0.82,
    sharpen: 0.18,
    noiseReduction: 0.52,
    toneMap: true,
    upscaleStyle: "enhanced"
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
