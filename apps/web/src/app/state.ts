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
