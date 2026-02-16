export type PreviewMode = "original" | "processed" | "split";

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
  toneMap: boolean;
  previewMode: PreviewMode;
  splitPosition: number;
};

export const DEFAULT_CAMERA_PARAMS: CameraParams = {
  exposureEV: 0,
  shutter: 1 / 250,
  iso: 100,
  aperture: 5.6,
  focalLength: 35,
  focusDistance: 4,
  distortion: 0,
  vignette: 0.25,
  chromaAberration: 0,
  toneMap: true,
  previewMode: "processed",
  splitPosition: 0.5
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
    chromaAberration: 0.08
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
    chromaAberration: 0.03
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
    chromaAberration: 0.12
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
