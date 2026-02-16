import {
  CAMERA_PRESETS,
  CameraParamStore,
  DEFAULT_CAMERA_PARAMS,
  type CameraParams,
  type CameraPresetName,
  type HistogramMode,
  type UpscaleFactor
} from "./state";
import { type HistogramData, WebGLImageRenderer } from "./gl/WebGLImageRenderer";

type SourceMode = "image" | "webcam";
type NumericParamKey =
  | "exposureEV"
  | "shutter"
  | "iso"
  | "aperture"
  | "focalLength"
  | "focusDistance"
  | "distortion"
  | "vignette"
  | "chromaAberration"
  | "temperature"
  | "tint"
  | "contrast"
  | "saturation"
  | "sharpen"
  | "noiseReduction";

type PresetPatch = Pick<
  CameraParams,
  | "exposureEV"
  | "shutter"
  | "iso"
  | "aperture"
  | "focalLength"
  | "focusDistance"
  | "distortion"
  | "vignette"
  | "chromaAberration"
  | "temperature"
  | "tint"
  | "contrast"
  | "saturation"
  | "sharpen"
  | "noiseReduction"
  | "toneMap"
>;

type SliderControlDef = {
  key: NumericParamKey;
  label: string;
  min: number;
  max: number;
  step: number;
  toValue: (raw: number) => number;
  toRaw: (value: number) => number;
  format: (value: number) => string;
};

type SliderBinding = {
  def: SliderControlDef;
  input: HTMLInputElement;
  readout: HTMLOutputElement;
};

type DialKind = "standard" | "aperture" | "lens-zoom" | "lens-focus";

type DialBinding = {
  def: SliderControlDef;
  root: HTMLElement;
  knob: HTMLElement;
  readout: HTMLOutputElement;
  values: readonly number[];
  kind: DialKind;
};

type ControlTheme = "sliders" | "camera";

type AppElements = {
  canvas: HTMLCanvasElement;
  fileInput: HTMLInputElement;
  snapshotButton: HTMLButtonElement;
  imageSourceButton: HTMLButtonElement;
  webcamSourceButton: HTMLButtonElement;
  presetSelect: HTMLSelectElement;
  presetApplyButton: HTMLButtonElement;
  presetResetButton: HTMLButtonElement;
  presetNameInput: HTMLInputElement;
  presetSaveButton: HTMLButtonElement;
  presetDeleteButton: HTMLButtonElement;
  previewOriginalButton: HTMLButtonElement;
  previewProcessedButton: HTMLButtonElement;
  previewSplitButton: HTMLButtonElement;
  splitControl: HTMLElement;
  splitSlider: HTMLInputElement;
  splitReadout: HTMLOutputElement;
  toneMapToggle: HTMLInputElement;
  upscaleSelect: HTMLSelectElement;
  performanceSelect: HTMLSelectElement;
  autoExposureToggle: HTMLInputElement;
  autoFocusToggle: HTMLInputElement;
  aeAfLockToggle: HTMLInputElement;
  controlThemeSelect: HTMLSelectElement;
  histogramModeSelect: HTMLSelectElement;
  paramControls: HTMLElement;
  paramDialControls: HTMLElement;
  histogramCanvas: HTMLCanvasElement;
  fileName: HTMLElement;
  status: HTMLElement;
  previewPanel: HTMLElement;
  emptyState: HTMLElement;
};

const SESSION_STORAGE_KEY = "obscura.session.v1";
const CUSTOM_PRESETS_STORAGE_KEY = "obscura.custom-presets.v1";
const CONTROL_THEME_STORAGE_KEY = "obscura.control-theme.v1";
const BUILTIN_PRESET_NAMES: readonly CameraPresetName[] = ["Portrait", "Landscape", "Night"];
const IDENTITY = (value: number): number => value;
const SHUTTER_MIN = 1 / 8000;
const SHUTTER_MAX = 1 / 15;
const DIAL_MIN_ANGLE_DEG = -140;
const DIAL_MAX_ANGLE_DEG = 140;
const DIAL_SWEEP_DEG = DIAL_MAX_ANGLE_DEG - DIAL_MIN_ANGLE_DEG;

const toShutterSeconds = (sliderValue: number): number =>
  SHUTTER_MIN * Math.pow(SHUTTER_MAX / SHUTTER_MIN, clamp(sliderValue, 0, 1));

const toShutterSlider = (seconds: number): number =>
  Math.log(seconds / SHUTTER_MIN) / Math.log(SHUTTER_MAX / SHUTTER_MIN);

const formatSigned = (value: number, digits: number): string => {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}`;
};

const formatShutter = (seconds: number): string => {
  if (seconds >= 1) {
    return `${seconds.toFixed(2)}s`;
  }

  const denominator = Math.max(1, Math.round(1 / seconds));
  return `1/${denominator}`;
};

const PARAM_SLIDER_DEFS: SliderControlDef[] = [
  {
    key: "exposureEV",
    label: "Exposure (EV)",
    min: -3,
    max: 3,
    step: 0.01,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => formatSigned(value, 2)
  },
  {
    key: "shutter",
    label: "Shutter",
    min: 0,
    max: 1,
    step: 0.001,
    toValue: toShutterSeconds,
    toRaw: toShutterSlider,
    format: formatShutter
  },
  {
    key: "iso",
    label: "ISO",
    min: 100,
    max: 6400,
    step: 1,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => `${Math.round(value)}`
  },
  {
    key: "aperture",
    label: "Aperture",
    min: 1.4,
    max: 22,
    step: 0.1,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => `f/${value.toFixed(1)}`
  },
  {
    key: "focalLength",
    label: "Focal Length",
    min: 18,
    max: 120,
    step: 1,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => `${Math.round(value)}mm`
  },
  {
    key: "focusDistance",
    label: "Focus Distance",
    min: 0.2,
    max: 50,
    step: 0.1,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => `${value.toFixed(1)}m`
  },
  {
    key: "distortion",
    label: "Distortion",
    min: -0.5,
    max: 0.5,
    step: 0.01,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => formatSigned(value, 2)
  },
  {
    key: "vignette",
    label: "Vignette",
    min: 0,
    max: 1,
    step: 0.01,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => value.toFixed(2)
  },
  {
    key: "chromaAberration",
    label: "Chroma Aberration",
    min: 0,
    max: 1,
    step: 0.01,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => value.toFixed(2)
  },
  {
    key: "temperature",
    label: "White Balance Temp",
    min: -1,
    max: 1,
    step: 0.01,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => formatSigned(value, 2)
  },
  {
    key: "tint",
    label: "White Balance Tint",
    min: -1,
    max: 1,
    step: 0.01,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => formatSigned(value, 2)
  },
  {
    key: "contrast",
    label: "Contrast",
    min: 0.5,
    max: 1.5,
    step: 0.01,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => value.toFixed(2)
  },
  {
    key: "saturation",
    label: "Saturation",
    min: 0,
    max: 2,
    step: 0.01,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => value.toFixed(2)
  },
  {
    key: "sharpen",
    label: "Sharpen",
    min: 0,
    max: 1,
    step: 0.01,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => value.toFixed(2)
  },
  {
    key: "noiseReduction",
    label: "Noise Reduction",
    min: 0,
    max: 1,
    step: 0.01,
    toValue: IDENTITY,
    toRaw: IDENTITY,
    format: (value) => value.toFixed(2)
  }
];

const PARAM_DIAL_VALUES: Record<NumericParamKey, readonly number[]> = {
  exposureEV: [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3],
  shutter: [1 / 8000, 1 / 4000, 1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 125, 1 / 60, 1 / 30, 1 / 15],
  iso: [100, 200, 400, 800, 1600, 3200, 6400],
  aperture: [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22],
  focalLength: [18, 24, 28, 35, 50, 70, 85, 105, 120],
  focusDistance: [0.2, 0.3, 0.5, 0.8, 1.2, 1.6, 2.5, 4, 6, 10, 15, 25, 50],
  distortion: [-0.5, -0.3, -0.15, -0.05, 0, 0.05, 0.15, 0.3, 0.5],
  vignette: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1],
  chromaAberration: [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 1],
  temperature: [-1, -0.7, -0.4, -0.2, 0, 0.2, 0.4, 0.7, 1],
  tint: [-1, -0.7, -0.4, -0.2, 0, 0.2, 0.4, 0.7, 1],
  contrast: [0.5, 0.7, 0.85, 1, 1.15, 1.3, 1.5],
  saturation: [0, 0.4, 0.7, 1, 1.3, 1.6, 2],
  sharpen: [0, 0.15, 0.3, 0.45, 0.6, 0.8, 1],
  noiseReduction: [0, 0.15, 0.3, 0.45, 0.6, 0.8, 1]
};

export class CameraLabApp {
  private readonly root: HTMLElement;
  private readonly params = new CameraParamStore(DEFAULT_CAMERA_PARAMS);
  private readonly sliderBindings: SliderBinding[] = [];
  private readonly dialBindings: DialBinding[] = [];
  private renderer?: WebGLImageRenderer;
  private elements?: AppElements;
  private controlTheme: ControlTheme = "sliders";
  private sourceMode: SourceMode = "image";
  private hasImage = false;
  private webcamStream?: MediaStream;
  private webcamVideo?: HTMLVideoElement;
  private webcamFrameHandle?: number;
  private sourceSwitchToken = 0;
  private unsubscribeParams?: () => void;
  private lastHistogramVersion = -1;
  private customPresets: Record<string, PresetPatch> = {};
  private loadedImage?: HTMLImageElement;
  private readonly meterCanvas = document.createElement("canvas");

  private readonly onResize = () => {
    this.renderer?.resize();
  };

  private readonly blockWindowDrop = (event: DragEvent) => {
    event.preventDefault();
  };

  private readonly onPageHide = () => {
    this.disableWebcam();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isEditableTarget(event.target)) {
      return;
    }

    const state = this.params.getState();

    if (event.code === "Space") {
      event.preventDefault();
      this.params.set("previewMode", state.previewMode === "original" ? "processed" : "original");
      if (this.elements) {
        this.elements.status.textContent = "Toggled A/B preview.";
      }
      return;
    }

    if (event.code === "KeyS") {
      event.preventDefault();
      this.params.set("previewMode", state.previewMode === "split" ? "processed" : "split");
      if (this.elements) {
        this.elements.status.textContent =
          state.previewMode === "split" ? "Split preview off." : "Split preview on.";
      }
      return;
    }

    if (event.code === "KeyR") {
      event.preventDefault();
      this.params.reset();
      if (this.elements) {
        this.elements.status.textContent = "Reset to default parameters.";
      }
    }
  };

  constructor(root: HTMLElement) {
    this.root = root;
  }

  mount(): void {
    this.root.innerHTML = `
      <div class="app-shell">
        <aside class="control-panel">
          <h1>CameraLab Web MVP</h1>
          <p class="lead">
            T8+ implementation: snapshot, custom presets, histogram modes, and session restore.
          </p>

          <section class="control-block">
            <p class="control-title">Source</p>
            <div class="source-toggle" role="group" aria-label="Source Select">
              <button id="source-image" class="source-button is-active" type="button">Image</button>
              <button id="source-webcam" class="source-button" type="button">Webcam</button>
            </div>
            <div class="source-actions">
              <button id="snapshot-button" class="mini-button" type="button">Save PNG</button>
            </div>
            <label class="file-button" for="file-input">Choose Image</label>
            <input id="file-input" type="file" accept="image/*" />
            <p class="hint">You can also drag and drop an image file onto the preview area.</p>
          </section>

          <section class="control-block">
            <p class="control-title">Presets</p>
            <div class="preset-row">
              <select id="preset-select"></select>
              <button id="preset-apply" class="mini-button" type="button">Apply</button>
              <button id="preset-reset" class="mini-button is-muted" type="button">Reset</button>
            </div>
            <div class="preset-custom-row">
              <input id="preset-name-input" type="text" placeholder="Custom preset name" />
              <button id="preset-save" class="mini-button" type="button">Save Current</button>
              <button id="preset-delete" class="mini-button is-muted" type="button">Delete</button>
            </div>
          </section>

          <section class="control-block">
            <p class="control-title">Preview</p>
            <div class="preview-toggle" role="group" aria-label="Preview Mode">
              <button id="preview-original" class="preview-button" type="button">A</button>
              <button id="preview-processed" class="preview-button is-active" type="button">B</button>
              <button id="preview-split" class="preview-button" type="button">Split</button>
            </div>
            <label id="split-control" class="split-control" for="split-slider">
              <span>Split Position</span>
              <input id="split-slider" type="range" min="0" max="1" step="0.01" value="0.5" />
              <output id="split-readout">50%</output>
            </label>
            <label class="tone-map-row" for="tone-map-toggle">
              <span>Tone Mapping</span>
              <input id="tone-map-toggle" type="checkbox" />
            </label>
            <label class="upscale-row" for="upscale-select">
              <span>Upscale</span>
              <select id="upscale-select">
                <option value="1">1x</option>
                <option value="1.5">1.5x</option>
                <option value="2">2x</option>
                <option value="2.5">2.5x</option>
                <option value="3">3x</option>
                <option value="3.5">3.5x</option>
                <option value="4">4x</option>
              </select>
            </label>
            <label class="upscale-row" for="performance-select">
              <span>Performance</span>
              <select id="performance-select">
                <option value="1">Quality</option>
                <option value="0.75">Balanced</option>
                <option value="0.5">Fast</option>
              </select>
            </label>
            <label class="toggle-row" for="auto-exposure-toggle">
              <span>Auto Exposure (tap)</span>
              <input id="auto-exposure-toggle" type="checkbox" checked />
            </label>
            <label class="toggle-row" for="auto-focus-toggle">
              <span>Auto Focus (tap)</span>
              <input id="auto-focus-toggle" type="checkbox" checked />
            </label>
            <label class="toggle-row" for="aeaf-lock-toggle">
              <span>AE/AF Lock</span>
              <input id="aeaf-lock-toggle" type="checkbox" />
            </label>
            <p class="hint">Shortcuts: <code>Space</code> A/B, <code>S</code> Split, <code>R</code> Reset</p>
          </section>

          <section class="control-block param-section">
            <p class="control-title">Camera Parameters</p>
            <label class="theme-row" for="control-theme-select">
              <span>Control Theme</span>
              <select id="control-theme-select">
                <option value="sliders">Sliders</option>
                <option value="camera">Camera Dials</option>
              </select>
            </label>
            <div id="param-controls" class="param-controls"></div>
            <div id="param-dial-controls" class="param-dial-controls is-hidden"></div>
          </section>

          <section class="control-block">
            <p class="control-title">Histogram</p>
            <label class="histogram-mode-row" for="histogram-mode-select">
              <span>Mode</span>
              <select id="histogram-mode-select">
                <option value="original">Original</option>
                <option value="processed">Processed</option>
                <option value="composite">Composite</option>
              </select>
            </label>
            <canvas id="histogram-canvas" class="histogram-canvas" width="320" height="120"></canvas>
          </section>

          <p class="file-name" id="file-name">No image loaded</p>
          <p class="status" id="status">Waiting for image input.</p>
        </aside>

        <section class="preview-panel" id="preview-panel">
          <canvas id="preview-canvas"></canvas>
          <div class="empty-state" id="empty-state">Drop image here or use "Choose Image"</div>
        </section>
      </div>
    `;

    this.elements = this.collectElements();
    this.renderer = new WebGLImageRenderer(this.elements.canvas);
    this.createParameterControls();
    this.createParameterDialControls();
    this.restoreControlTheme();
    this.syncControlThemeView();
    this.bindFileInput();
    this.bindDragAndDrop();
    this.bindSourceButtons();
    this.bindPresetControls();
    this.bindPreviewControls();
    this.bindControlTheme();
    this.bindMeteringControls();
    this.bindSnapshotControl();

    this.loadCustomPresets();
    this.rebuildPresetSelect();
    this.restoreSessionState();

    this.unsubscribeParams = this.params.subscribe((state) => {
      this.renderer?.setParams(state);
      this.syncParameterControls(state);
      this.syncPreviewControls(state);
      this.persistSessionState(state);

      if (this.sourceMode !== "webcam" || !this.webcamVideo) {
        this.renderer?.render();
        this.drawHistogram();
      }
    });

    window.addEventListener("resize", this.onResize);
    window.addEventListener("dragover", this.blockWindowDrop);
    window.addEventListener("drop", this.blockWindowDrop);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("keydown", this.onKeyDown);

    this.renderer.resize();
    this.refreshEmptyState();
    this.renderer.render();
    this.drawHistogram();
  }

  destroy(): void {
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("dragover", this.blockWindowDrop);
    window.removeEventListener("drop", this.blockWindowDrop);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("keydown", this.onKeyDown);

    this.disableWebcam();
    this.unsubscribeParams?.();
    this.unsubscribeParams = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
    this.elements = undefined;
  }

  private collectElements(): AppElements {
    return {
      canvas: this.requireElement<HTMLCanvasElement>("#preview-canvas"),
      fileInput: this.requireElement<HTMLInputElement>("#file-input"),
      snapshotButton: this.requireElement<HTMLButtonElement>("#snapshot-button"),
      imageSourceButton: this.requireElement<HTMLButtonElement>("#source-image"),
      webcamSourceButton: this.requireElement<HTMLButtonElement>("#source-webcam"),
      presetSelect: this.requireElement<HTMLSelectElement>("#preset-select"),
      presetApplyButton: this.requireElement<HTMLButtonElement>("#preset-apply"),
      presetResetButton: this.requireElement<HTMLButtonElement>("#preset-reset"),
      presetNameInput: this.requireElement<HTMLInputElement>("#preset-name-input"),
      presetSaveButton: this.requireElement<HTMLButtonElement>("#preset-save"),
      presetDeleteButton: this.requireElement<HTMLButtonElement>("#preset-delete"),
      previewOriginalButton: this.requireElement<HTMLButtonElement>("#preview-original"),
      previewProcessedButton: this.requireElement<HTMLButtonElement>("#preview-processed"),
      previewSplitButton: this.requireElement<HTMLButtonElement>("#preview-split"),
      splitControl: this.requireElement<HTMLElement>("#split-control"),
      splitSlider: this.requireElement<HTMLInputElement>("#split-slider"),
      splitReadout: this.requireElement<HTMLOutputElement>("#split-readout"),
      toneMapToggle: this.requireElement<HTMLInputElement>("#tone-map-toggle"),
      upscaleSelect: this.requireElement<HTMLSelectElement>("#upscale-select"),
      performanceSelect: this.requireElement<HTMLSelectElement>("#performance-select"),
      autoExposureToggle: this.requireElement<HTMLInputElement>("#auto-exposure-toggle"),
      autoFocusToggle: this.requireElement<HTMLInputElement>("#auto-focus-toggle"),
      aeAfLockToggle: this.requireElement<HTMLInputElement>("#aeaf-lock-toggle"),
      controlThemeSelect: this.requireElement<HTMLSelectElement>("#control-theme-select"),
      histogramModeSelect: this.requireElement<HTMLSelectElement>("#histogram-mode-select"),
      paramControls: this.requireElement<HTMLElement>("#param-controls"),
      paramDialControls: this.requireElement<HTMLElement>("#param-dial-controls"),
      histogramCanvas: this.requireElement<HTMLCanvasElement>("#histogram-canvas"),
      fileName: this.requireElement<HTMLElement>("#file-name"),
      status: this.requireElement<HTMLElement>("#status"),
      previewPanel: this.requireElement<HTMLElement>("#preview-panel"),
      emptyState: this.requireElement<HTMLElement>("#empty-state")
    };
  }

  private createParameterControls(): void {
    if (!this.elements) {
      return;
    }

    this.sliderBindings.length = 0;
    this.elements.paramControls.innerHTML = "";

    for (const def of PARAM_SLIDER_DEFS) {
      const row = document.createElement("label");
      row.className = "param-row";
      row.htmlFor = `param-${def.key}`;

      const name = document.createElement("span");
      name.className = "param-name";
      name.textContent = def.label;

      const input = document.createElement("input");
      input.className = "param-slider";
      input.type = "range";
      input.id = `param-${def.key}`;
      input.min = `${def.min}`;
      input.max = `${def.max}`;
      input.step = `${def.step}`;

      const readout = document.createElement("output");
      readout.className = "param-value";

      row.append(name, input, readout);
      this.elements.paramControls.append(row);

      input.addEventListener("input", () => {
        const nextValue = def.toValue(Number(input.value));
        this.params.set(def.key, nextValue);
      });

      this.sliderBindings.push({
        def,
        input,
        readout
      });
    }
  }

  private createParameterDialControls(): void {
    if (!this.elements) {
      return;
    }

    this.dialBindings.length = 0;
    this.elements.paramDialControls.innerHTML = "";

    for (const def of PARAM_SLIDER_DEFS) {
      const values = PARAM_DIAL_VALUES[def.key];
      const kind = dialKindForKey(def.key);
      const row = document.createElement("div");
      row.className = "dial-row";

      const name = document.createElement("span");
      name.className = "dial-name";
      name.textContent = def.label;

      const controls = document.createElement("div");
      controls.className = "dial-controls";

      const dial = document.createElement("div");
      dial.className = "dial-knob";
      dial.tabIndex = 0;
      dial.dataset.kind = kind;
      dial.setAttribute("role", "slider");
      dial.setAttribute("aria-label", def.label);

      const ring = document.createElement("div");
      ring.className = "dial-ring";

      const readout = document.createElement("output");
      readout.className = "dial-readout";

      const marker = document.createElement("div");
      marker.className = "dial-marker";

      const center = document.createElement("div");
      center.className = "dial-center";

      if (kind === "aperture") {
        const iris = document.createElement("div");
        iris.className = "dial-aperture";
        const hole = document.createElement("div");
        hole.className = "dial-aperture-hole";
        iris.append(hole);
        center.append(iris);
      } else if (kind === "lens-zoom" || kind === "lens-focus") {
        const lens = document.createElement("div");
        lens.className = "dial-lens";
        const tube = document.createElement("div");
        tube.className = "dial-lens-tube";
        const glass = document.createElement("div");
        glass.className = "dial-lens-glass";
        lens.append(tube, glass);
        center.append(lens);
      }

      dial.append(ring, center, marker);
      controls.append(dial, readout);
      row.append(name, controls);
      this.elements.paramDialControls.append(row);

      this.bindDialInput(dial, def.key, values);

      this.dialBindings.push({
        def,
        root: dial,
        knob: ring,
        readout,
        values,
        kind
      });
    }
  }

  private bindFileInput(): void {
    if (!this.elements) {
      return;
    }

    const { fileInput } = this.elements;
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        return;
      }

      await this.loadIntoRenderer(file);
      fileInput.value = "";
    });
  }

  private bindSourceButtons(): void {
    if (!this.elements) {
      return;
    }

    this.elements.imageSourceButton.addEventListener("click", () => {
      void this.setSourceMode("image");
    });

    this.elements.webcamSourceButton.addEventListener("click", () => {
      void this.setSourceMode("webcam");
    });
  }

  private bindSnapshotControl(): void {
    if (!this.elements) {
      return;
    }

    this.elements.snapshotButton.addEventListener("click", () => {
      void this.captureSnapshotPng();
    });
  }

  private bindPresetControls(): void {
    if (!this.elements) {
      return;
    }

    const {
      presetApplyButton,
      presetResetButton,
      presetSelect,
      presetNameInput,
      presetSaveButton,
      presetDeleteButton
    } = this.elements;

    presetSelect.addEventListener("change", () => {
      this.applyPresetSelection(presetSelect.value);
    });

    presetApplyButton.addEventListener("click", () => {
      this.applyPresetSelection(presetSelect.value);
    });

    presetResetButton.addEventListener("click", () => {
      this.params.reset();
      this.setStatus("Reset to default parameters.");
    });

    presetSaveButton.addEventListener("click", () => {
      const requestedName = presetNameInput.value.trim();
      this.saveCurrentAsCustomPreset(requestedName);
    });

    presetDeleteButton.addEventListener("click", () => {
      this.deleteSelectedCustomPreset();
    });
  }

  private bindPreviewControls(): void {
    if (!this.elements) {
      return;
    }

    const {
      previewOriginalButton,
      previewProcessedButton,
      previewSplitButton,
      splitSlider,
      toneMapToggle,
      upscaleSelect,
      performanceSelect,
      histogramModeSelect
    } = this.elements;

    previewOriginalButton.addEventListener("click", () => {
      this.params.set("previewMode", "original");
    });
    previewProcessedButton.addEventListener("click", () => {
      this.params.set("previewMode", "processed");
    });
    previewSplitButton.addEventListener("click", () => {
      this.params.set("previewMode", "split");
    });
    splitSlider.addEventListener("input", () => {
      this.params.set("splitPosition", clamp(Number(splitSlider.value), 0, 1));
    });
    toneMapToggle.addEventListener("change", () => {
      this.params.set("toneMap", Boolean(toneMapToggle.checked));
    });
    upscaleSelect.addEventListener("change", () => {
      this.params.set("upscaleFactor", parseUpscaleFactor(upscaleSelect.value));
      const effective = this.renderer?.getEffectiveProcessScale();
      if (effective) {
        const x = effective.x.toFixed(2);
        const y = effective.y.toFixed(2);
        this.setStatus(`Upscale applied (effective ${x}x / ${y}x).`);
      }
    });
    performanceSelect.addEventListener("change", () => {
      this.params.set("previewScale", parsePreviewScale(performanceSelect.value));
    });
    histogramModeSelect.addEventListener("change", () => {
      this.params.set("histogramMode", histogramModeSelect.value as HistogramMode);
    });
  }

  private bindControlTheme(): void {
    if (!this.elements) {
      return;
    }

    const { controlThemeSelect } = this.elements;
    controlThemeSelect.addEventListener("change", () => {
      const nextTheme = parseControlTheme(controlThemeSelect.value);
      this.controlTheme = nextTheme;
      writeStorage(CONTROL_THEME_STORAGE_KEY, nextTheme);
      this.syncControlThemeView();
    });
  }

  private restoreControlTheme(): void {
    const raw = readStorage(CONTROL_THEME_STORAGE_KEY);
    this.controlTheme = parseControlTheme(raw);
  }

  private syncControlThemeView(): void {
    if (!this.elements) {
      return;
    }

    this.elements.controlThemeSelect.value = this.controlTheme;
    const isCameraTheme = this.controlTheme === "camera";
    this.elements.paramControls.classList.toggle("is-hidden", isCameraTheme);
    this.elements.paramDialControls.classList.toggle("is-hidden", !isCameraTheme);
  }

  private stepDialValue(key: NumericParamKey, delta: -1 | 1): void {
    const state = this.params.getState();
    const values = PARAM_DIAL_VALUES[key];
    if (values.length === 0) {
      return;
    }

    const currentIndex = findNearestValueIndex(values, state[key]);
    const nextIndex = clamp(currentIndex + delta, 0, values.length - 1);
    this.params.set(key, values[nextIndex]);
  }

  private bindDialInput(dial: HTMLElement, key: NumericParamKey, values: readonly number[]): void {
    dial.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.stepDialValue(key, event.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );

    dial.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        this.stepDialValue(key, -1);
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        this.stepDialValue(key, 1);
      }
    });

    dial.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();

      dial.setPointerCapture(event.pointerId);
      const initialState = this.params.getState();
      const startIndex = findNearestValueIndex(values, initialState[key]);
      const startAngle = pointerAngleFromEvent(event, dial);
      const stepAngle = DIAL_SWEEP_DEG / Math.max(1, values.length - 1);

      const onMove = (moveEvent: PointerEvent) => {
        const currentAngle = pointerAngleFromEvent(moveEvent, dial);
        const deltaAngle = shortestAngleDelta(startAngle, currentAngle);
        const stepOffset = Math.round(deltaAngle / stepAngle);
        const nextIndex = clamp(startIndex + stepOffset, 0, values.length - 1);
        this.params.set(key, values[nextIndex]);
      };

      const finish = () => {
        dial.removeEventListener("pointermove", onMove);
        dial.removeEventListener("pointerup", finish);
        dial.removeEventListener("pointercancel", finish);
      };

      dial.addEventListener("pointermove", onMove);
      dial.addEventListener("pointerup", finish);
      dial.addEventListener("pointercancel", finish);
    });
  }

  private bindMeteringControls(): void {
    if (!this.elements) {
      return;
    }

    const { canvas, autoExposureToggle, autoFocusToggle, aeAfLockToggle } = this.elements;

    canvas.addEventListener("pointerdown", (event) => {
      this.handleMeteringTap(event);
    });

    aeAfLockToggle.addEventListener("change", () => {
      this.setStatus(aeAfLockToggle.checked ? "AE/AF lock enabled." : "AE/AF lock released.");
    });

    autoExposureToggle.addEventListener("change", () => {
      const state = autoExposureToggle.checked ? "enabled" : "disabled";
      this.setStatus(`Auto Exposure ${state}.`);
    });

    autoFocusToggle.addEventListener("change", () => {
      const state = autoFocusToggle.checked ? "enabled" : "disabled";
      this.setStatus(`Auto Focus ${state}.`);
    });
  }

  private handleMeteringTap(event: PointerEvent): void {
    if (!this.elements) {
      return;
    }
    if (this.elements.aeAfLockToggle.checked) {
      this.setStatus("AE/AF is locked.");
      return;
    }

    const shouldAutoExposure = this.elements.autoExposureToggle.checked;
    const shouldAutoFocus = this.elements.autoFocusToggle.checked;
    if (!shouldAutoExposure && !shouldAutoFocus) {
      return;
    }

    const sample = this.sampleMeteringAt(event.clientX, event.clientY);
    if (!sample) {
      return;
    }

    const patch: Partial<CameraParams> = {};
    if (shouldAutoExposure) {
      patch.exposureEV = computeAutoExposure(sample.luminance);
    }
    if (shouldAutoFocus) {
      patch.focusDistance = computeAutoFocusDistance(sample.depthNorm);
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    this.params.patch(patch);

    const updates: string[] = [];
    if (patch.exposureEV !== undefined) {
      updates.push(`EV ${formatSigned(patch.exposureEV, 2)}`);
    }
    if (patch.focusDistance !== undefined) {
      updates.push(`Focus ${patch.focusDistance.toFixed(1)}m`);
    }
    this.setStatus(`Metered: ${updates.join(", ")}`);
  }

  private sampleMeteringAt(clientX: number, clientY: number): { luminance: number; depthNorm: number } | null {
    if (!this.elements) {
      return null;
    }

    const dims = this.getActiveSourceDimensions();
    if (!dims) {
      this.setStatus("No active source for metering.");
      return null;
    }

    const rect = this.elements.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((clientY - rect.top) / rect.height, 0, 1);
    const uv = mapCanvasToImageUv(nx, ny, rect.width, rect.height, dims.width, dims.height);
    if (!uv) {
      return null;
    }

    const luminance = this.sampleSourceLuminance(uv.x, uv.y, dims.width, dims.height);
    if (luminance === null) {
      return null;
    }

    const depthNorm = clamp(Math.hypot(uv.x - 0.5, uv.y - 0.5) * 1.8, 0, 1);
    return { luminance, depthNorm };
  }

  private getActiveSourceDimensions(): { width: number; height: number } | null {
    if (this.sourceMode === "webcam" && this.webcamVideo) {
      return {
        width: Math.max(1, this.webcamVideo.videoWidth || 1),
        height: Math.max(1, this.webcamVideo.videoHeight || 1)
      };
    }

    if (this.loadedImage) {
      return {
        width: Math.max(1, this.loadedImage.naturalWidth || 1),
        height: Math.max(1, this.loadedImage.naturalHeight || 1)
      };
    }

    return null;
  }

  private sampleSourceLuminance(uvX: number, uvY: number, width: number, height: number): number | null {
    const target = this.sourceMode === "webcam" ? this.webcamVideo : this.loadedImage;
    if (!target) {
      return null;
    }

    this.meterCanvas.width = width;
    this.meterCanvas.height = height;
    const ctx = this.meterCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return null;
    }

    ctx.drawImage(target, 0, 0, width, height);
    const sampleX = Math.min(width - 1, Math.max(0, Math.floor(uvX * (width - 1))));
    const sampleY = Math.min(height - 1, Math.max(0, Math.floor(uvY * (height - 1))));
    const pixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
    const r = srgbToLinear(pixel[0] / 255);
    const g = srgbToLinear(pixel[1] / 255);
    const b = srgbToLinear(pixel[2] / 255);
    return clamp(r * 0.2126 + g * 0.7152 + b * 0.0722, 0.001, 1);
  }

  private bindDragAndDrop(): void {
    if (!this.elements) {
      return;
    }

    const { previewPanel } = this.elements;

    previewPanel.addEventListener("dragenter", (event) => {
      event.preventDefault();
      previewPanel.classList.add("is-dragging");
    });

    previewPanel.addEventListener("dragover", (event) => {
      event.preventDefault();
      previewPanel.classList.add("is-dragging");
    });

    previewPanel.addEventListener("dragleave", (event) => {
      event.preventDefault();
      previewPanel.classList.remove("is-dragging");
    });

    previewPanel.addEventListener("drop", async (event) => {
      event.preventDefault();
      previewPanel.classList.remove("is-dragging");

      const file = event.dataTransfer?.files?.[0];
      if (!file) {
        return;
      }

      await this.loadIntoRenderer(file);
    });
  }

  private syncParameterControls(state: Readonly<CameraParams>): void {
    for (const binding of this.sliderBindings) {
      const currentValue = state[binding.def.key];
      const nextRaw = clamp(binding.def.toRaw(currentValue), binding.def.min, binding.def.max);
      binding.input.value = `${nextRaw}`;
      binding.readout.textContent = binding.def.format(currentValue);
    }

    for (const binding of this.dialBindings) {
      const currentValue = state[binding.def.key];
      const index = findNearestValueIndex(binding.values, currentValue);
      const angle = dialAngleForIndex(index, binding.values.length);
      const ratio = index / Math.max(1, binding.values.length - 1);
      binding.readout.textContent = binding.def.format(currentValue);
      binding.knob.style.transform = `rotate(${angle}deg)`;
      binding.root.style.setProperty("--dial-ratio", `${ratio}`);
      binding.root.setAttribute("aria-valuemin", `${binding.values[0]}`);
      binding.root.setAttribute("aria-valuemax", `${binding.values[binding.values.length - 1]}`);
      binding.root.setAttribute("aria-valuenow", `${currentValue}`);
      binding.root.setAttribute("aria-valuetext", binding.def.format(currentValue));

      if (binding.kind === "aperture") {
        const apertureOpen = 1 - clamp((currentValue - 1.4) / (22 - 1.4), 0, 1);
        binding.root.style.setProperty("--aperture-open", `${apertureOpen}`);
      } else if (binding.kind === "lens-zoom") {
        const zoomNorm = clamp((currentValue - 18) / (120 - 18), 0, 1);
        binding.root.style.setProperty("--lens-zoom", `${zoomNorm}`);
      } else if (binding.kind === "lens-focus") {
        const focusNorm = clamp(Math.log(currentValue / 0.2) / Math.log(50 / 0.2), 0, 1);
        binding.root.style.setProperty("--lens-focus", `${focusNorm}`);
      }
    }
  }

  private syncPreviewControls(state: Readonly<CameraParams>): void {
    if (!this.elements) {
      return;
    }

    this.elements.previewOriginalButton.classList.toggle("is-active", state.previewMode === "original");
    this.elements.previewProcessedButton.classList.toggle(
      "is-active",
      state.previewMode === "processed"
    );
    this.elements.previewSplitButton.classList.toggle("is-active", state.previewMode === "split");
    this.elements.splitReadout.textContent = `${Math.round(state.splitPosition * 100)}%`;
    this.elements.splitSlider.value = `${state.splitPosition}`;
    this.elements.splitControl.classList.toggle("is-hidden", state.previewMode !== "split");
    this.elements.toneMapToggle.checked = state.toneMap;
    this.elements.upscaleSelect.value = `${state.upscaleFactor}`;
    this.elements.performanceSelect.value = `${state.previewScale}`;
    this.elements.histogramModeSelect.value = state.histogramMode;
  }

  private async loadIntoRenderer(file: File): Promise<void> {
    if (!this.renderer || !this.elements) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      this.setStatus("Only image files are supported.");
      return;
    }

    this.setStatus("Loading image...");

    try {
      const image = await this.loadImageFile(file);

      this.sourceSwitchToken += 1;
      this.disableWebcam();
      this.sourceMode = "image";
      this.updateSourceButtons();

      this.renderer.setImage(image);
      this.renderer.render();
      this.drawHistogram();

      this.loadedImage = image;
      this.hasImage = true;
      this.elements.fileName.textContent = file.name;
      this.setStatus(`Loaded ${file.name}`);
      this.refreshEmptyState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown loading error.";
      this.setStatus(`Failed to load image: ${message}`);
    }
  }

  private async setSourceMode(mode: SourceMode): Promise<void> {
    if (!this.elements || !this.renderer || mode === this.sourceMode) {
      return;
    }

    if (mode === "image") {
      this.sourceSwitchToken += 1;
      this.disableWebcam();
      this.sourceMode = "image";
      this.updateSourceButtons();
      this.refreshEmptyState();
      this.renderer.render();
      this.drawHistogram();
      this.setStatus(this.hasImage ? "Showing uploaded image." : "Waiting for image input.");
      return;
    }

    this.sourceMode = "webcam";
    const switchToken = ++this.sourceSwitchToken;
    this.updateSourceButtons();
    this.refreshEmptyState();
    this.setStatus("Requesting webcam permission...");

    try {
      await this.startWebcam();
      if (switchToken !== this.sourceSwitchToken || this.sourceMode !== "webcam") {
        this.disableWebcam();
        return;
      }

      this.setStatus("Webcam active.");
      this.refreshEmptyState();
      this.startWebcamRenderLoop();
    } catch (error) {
      if (switchToken !== this.sourceSwitchToken || this.sourceMode !== "webcam") {
        return;
      }

      this.disableWebcam();
      this.sourceMode = "image";
      this.updateSourceButtons();
      this.refreshEmptyState();

      const message = error instanceof Error ? error.message : "Failed to start webcam.";
      this.setStatus(`Webcam unavailable: ${message}`);
    }
  }

  private async startWebcam(): Promise<void> {
    if (this.webcamStream && this.webcamVideo) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia is not supported in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = stream;

    try {
      await video.play();
      await this.waitForVideoFrame(video);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }

    this.webcamStream = stream;
    this.webcamVideo = video;
    this.renderer?.setVideoSource(video);
  }

  private waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const onLoadedData = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Webcam stream did not produce frames."));
      };
      const cleanup = () => {
        video.removeEventListener("loadeddata", onLoadedData);
        video.removeEventListener("error", onError);
      };

      video.addEventListener("loadeddata", onLoadedData, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
  }

  private startWebcamRenderLoop(): void {
    this.stopWebcamRenderLoop();

    const renderFrame = () => {
      if (!this.renderer || !this.webcamVideo || this.sourceMode !== "webcam") {
        return;
      }

      this.renderer.updateVideoFrame(this.webcamVideo);
      this.renderer.render();
      this.drawHistogram();
      this.webcamFrameHandle = requestAnimationFrame(renderFrame);
    };

    renderFrame();
  }

  private stopWebcamRenderLoop(): void {
    if (this.webcamFrameHandle !== undefined) {
      cancelAnimationFrame(this.webcamFrameHandle);
      this.webcamFrameHandle = undefined;
    }
  }

  private disableWebcam(): void {
    this.stopWebcamRenderLoop();

    if (this.webcamVideo) {
      this.webcamVideo.pause();
      this.webcamVideo.srcObject = null;
      this.webcamVideo = undefined;
    }

    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach((track) => track.stop());
      this.webcamStream = undefined;
    }
  }

  private updateSourceButtons(): void {
    if (!this.elements) {
      return;
    }

    this.elements.imageSourceButton.classList.toggle("is-active", this.sourceMode === "image");
    this.elements.webcamSourceButton.classList.toggle("is-active", this.sourceMode === "webcam");
  }

  private refreshEmptyState(): void {
    if (!this.elements) {
      return;
    }

    const hide = this.sourceMode === "webcam" || this.hasImage;
    this.elements.emptyState.classList.toggle("is-hidden", hide);
    this.elements.emptyState.textContent =
      this.sourceMode === "webcam"
        ? "Starting webcam..."
        : 'Drop image here or use "Choose Image"';
  }

  private drawHistogram(): void {
    if (!this.renderer || !this.elements) {
      return;
    }

    const histogram = this.renderer.getHistogram();
    if (histogram.version === this.lastHistogramVersion) {
      return;
    }

    this.lastHistogramVersion = histogram.version;
    const canvas = this.elements.histogramCanvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    this.renderHistogramCanvas(ctx, canvas, histogram);
  }

  private renderHistogramCanvas(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    histogram: HistogramData
  ): void {
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0f141c";
    ctx.fillRect(0, 0, width, height);

    const bins = histogram.r.length;
    const binWidth = width / bins;
    const maxValue = Math.max(1, histogram.maxBin);

    const drawChannel = (channel: Float32Array, color: string) => {
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let i = 0; i < bins; i += 1) {
        const x = i * binWidth;
        const y = height - (channel[i] / maxValue) * (height - 4);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };

    drawChannel(histogram.r, "rgba(255, 84, 84, 0.38)");
    drawChannel(histogram.g, "rgba(94, 235, 128, 0.32)");
    drawChannel(histogram.b, "rgba(92, 148, 255, 0.30)");
  }

  private async captureSnapshotPng(): Promise<void> {
    if (!this.elements || !this.renderer) {
      return;
    }

    const previousPreviewScale = this.params.getState().previewScale;
    let restored = false;

    try {
      if (previousPreviewScale < 1) {
        this.params.set("previewScale", 1);
        await waitForNextFrame();
      }

      const factor = this.params.getState().upscaleFactor;
      const canvas = this.renderer.captureSnapshotCanvas(factor);
      if (!canvas) {
        this.setStatus("Failed to capture snapshot.");
        return;
      }
      const blob = await canvasToPngBlob(canvas);
      if (!blob) {
        this.setStatus("Failed to capture snapshot.");
        return;
      }

      const filename = `obscura-shot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      this.setStatus(`Saved snapshot: ${filename}`);
    } finally {
      if (previousPreviewScale < 1) {
        this.params.set("previewScale", previousPreviewScale);
        restored = true;
      }
      if (restored) {
        await waitForNextFrame();
      }
    }
  }

  private applyPresetSelection(selection: string): void {
    const parsed = this.parsePresetSelection(selection);
    if (!parsed) {
      this.setStatus("Invalid preset selection.");
      return;
    }

    if (parsed.kind === "builtin") {
      const preset = CAMERA_PRESETS[parsed.name];
      this.params.patch(preset);
      if (this.elements) {
        this.elements.presetNameInput.value = "";
      }
      this.setStatus(`Applied ${parsed.name} preset.`);
      return;
    }

    const preset = this.customPresets[parsed.name];
    if (!preset) {
      this.setStatus(`Custom preset not found: ${parsed.name}`);
      return;
    }

    this.params.patch(preset);
    if (this.elements) {
      this.elements.presetNameInput.value = parsed.name;
    }
    this.setStatus(`Applied custom preset: ${parsed.name}`);
  }

  private saveCurrentAsCustomPreset(requestedName: string): void {
    if (!this.elements) {
      return;
    }

    const currentSelection = this.parsePresetSelection(this.elements.presetSelect.value);
    const fallbackName =
      currentSelection && currentSelection.kind === "custom" ? currentSelection.name : "";
    const finalName = requestedName || fallbackName;

    if (!finalName) {
      this.setStatus("Enter a custom preset name to save.");
      return;
    }

    this.customPresets[finalName] = extractPresetPatch(this.params.getState());
    this.persistCustomPresets();
    this.rebuildPresetSelect(`custom:${finalName}`);
    this.elements.presetNameInput.value = finalName;
    this.setStatus(`Saved custom preset: ${finalName}`);
  }

  private deleteSelectedCustomPreset(): void {
    if (!this.elements) {
      return;
    }

    const selected = this.parsePresetSelection(this.elements.presetSelect.value);
    const fromInput = this.elements.presetNameInput.value.trim();
    const targetName = selected && selected.kind === "custom" ? selected.name : fromInput;

    if (!targetName) {
      this.setStatus("Select or enter a custom preset to delete.");
      return;
    }

    if (!(targetName in this.customPresets)) {
      this.setStatus(`Custom preset not found: ${targetName}`);
      return;
    }

    delete this.customPresets[targetName];
    this.persistCustomPresets();
    this.rebuildPresetSelect();
    this.elements.presetNameInput.value = "";
    this.setStatus(`Deleted custom preset: ${targetName}`);
  }

  private rebuildPresetSelect(preferredSelection?: string): void {
    if (!this.elements) {
      return;
    }

    const select = this.elements.presetSelect;
    const previousValue = preferredSelection ?? select.value;
    select.innerHTML = "";

    const builtinGroup = document.createElement("optgroup");
    builtinGroup.label = "Built-in";
    for (const name of BUILTIN_PRESET_NAMES) {
      const option = document.createElement("option");
      option.value = `builtin:${name}`;
      option.textContent = name;
      builtinGroup.append(option);
    }
    select.append(builtinGroup);

    const customNames = Object.keys(this.customPresets).sort((a, b) => a.localeCompare(b));
    if (customNames.length > 0) {
      const customGroup = document.createElement("optgroup");
      customGroup.label = "Custom";
      for (const name of customNames) {
        const option = document.createElement("option");
        option.value = `custom:${name}`;
        option.textContent = name;
        customGroup.append(option);
      }
      select.append(customGroup);
    }

    const hasPrevious = [...select.options].some((option) => option.value === previousValue);
    select.value = hasPrevious ? previousValue : "builtin:Portrait";
  }

  private parsePresetSelection(
    selection: string
  ): { kind: "builtin"; name: CameraPresetName } | { kind: "custom"; name: string } | null {
    if (selection.startsWith("builtin:")) {
      const name = selection.slice("builtin:".length) as CameraPresetName;
      return BUILTIN_PRESET_NAMES.includes(name) ? { kind: "builtin", name } : null;
    }

    if (selection.startsWith("custom:")) {
      const name = selection.slice("custom:".length);
      return name ? { kind: "custom", name } : null;
    }

    return null;
  }

  private loadCustomPresets(): void {
    const raw = readStorage(CUSTOM_PRESETS_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return;
      }

      const next: Record<string, PresetPatch> = {};
      for (const [name, patchValue] of Object.entries(parsed as Record<string, unknown>)) {
        const patch = toPresetPatch(patchValue);
        if (name && patch) {
          next[name] = patch;
        }
      }

      this.customPresets = next;
    } catch {
      this.customPresets = {};
    }
  }

  private persistCustomPresets(): void {
    writeStorage(CUSTOM_PRESETS_STORAGE_KEY, JSON.stringify(this.customPresets));
  }

  private restoreSessionState(): void {
    const raw = readStorage(SESSION_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const patch = toSessionPatch(parsed);
      if (patch) {
        this.params.patch(patch);
      }
    } catch {
      // Ignore malformed storage payloads.
    }
  }

  private persistSessionState(state: Readonly<CameraParams>): void {
    writeStorage(SESSION_STORAGE_KEY, JSON.stringify(state));
  }

  private loadImageFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const imageUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(imageUrl);
        resolve(image);
      };

      image.onerror = () => {
        URL.revokeObjectURL(imageUrl);
        reject(new Error("The selected file could not be decoded."));
      };

      image.src = imageUrl;
    });
  }

  private setStatus(message: string): void {
    if (this.elements) {
      this.elements.status.textContent = message;
    }
  }

  private requireElement<T extends Element>(selector: string): T {
    const node = this.root.querySelector(selector);
    if (!node) {
      throw new Error(`Missing required element: ${selector}`);
    }

    return node as T;
  }
}

function extractPresetPatch(state: Readonly<CameraParams>): PresetPatch {
  return {
    exposureEV: state.exposureEV,
    shutter: state.shutter,
    iso: state.iso,
    aperture: state.aperture,
    focalLength: state.focalLength,
    focusDistance: state.focusDistance,
    distortion: state.distortion,
    vignette: state.vignette,
    chromaAberration: state.chromaAberration,
    temperature: state.temperature,
    tint: state.tint,
    contrast: state.contrast,
    saturation: state.saturation,
    sharpen: state.sharpen,
    noiseReduction: state.noiseReduction,
    toneMap: state.toneMap
  };
}

function toPresetPatch(value: unknown): PresetPatch | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<CameraParams>;
  if (
    !isFiniteNumber(candidate.exposureEV) ||
    !isFiniteNumber(candidate.shutter) ||
    !isFiniteNumber(candidate.iso) ||
    !isFiniteNumber(candidate.aperture) ||
    !isFiniteNumber(candidate.focalLength) ||
    !isFiniteNumber(candidate.focusDistance) ||
    !isFiniteNumber(candidate.distortion) ||
    !isFiniteNumber(candidate.vignette) ||
    !isFiniteNumber(candidate.chromaAberration) ||
    typeof candidate.toneMap !== "boolean"
  ) {
    return null;
  }

  const temperature = isFiniteNumber(candidate.temperature) ? candidate.temperature : 0;
  const tint = isFiniteNumber(candidate.tint) ? candidate.tint : 0;
  const contrast = isFiniteNumber(candidate.contrast) ? candidate.contrast : 1;
  const saturation = isFiniteNumber(candidate.saturation) ? candidate.saturation : 1;
  const sharpen = isFiniteNumber(candidate.sharpen) ? candidate.sharpen : DEFAULT_CAMERA_PARAMS.sharpen;
  const noiseReduction = isFiniteNumber(candidate.noiseReduction)
    ? candidate.noiseReduction
    : DEFAULT_CAMERA_PARAMS.noiseReduction;

  return {
    exposureEV: candidate.exposureEV,
    shutter: candidate.shutter,
    iso: candidate.iso,
    aperture: candidate.aperture,
    focalLength: candidate.focalLength,
    focusDistance: candidate.focusDistance,
    distortion: candidate.distortion,
    vignette: candidate.vignette,
    chromaAberration: candidate.chromaAberration,
    temperature,
    tint,
    contrast,
    saturation,
    sharpen,
    noiseReduction,
    toneMap: candidate.toneMap
  };
}

function toSessionPatch(value: unknown): Partial<CameraParams> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<CameraParams>;
  const patch: Partial<CameraParams> = {};
  if (isFiniteNumber(candidate.exposureEV)) patch.exposureEV = candidate.exposureEV;
  if (isFiniteNumber(candidate.shutter)) patch.shutter = candidate.shutter;
  if (isFiniteNumber(candidate.iso)) patch.iso = candidate.iso;
  if (isFiniteNumber(candidate.aperture)) patch.aperture = candidate.aperture;
  if (isFiniteNumber(candidate.focalLength)) patch.focalLength = candidate.focalLength;
  if (isFiniteNumber(candidate.focusDistance)) patch.focusDistance = candidate.focusDistance;
  if (isFiniteNumber(candidate.distortion)) patch.distortion = candidate.distortion;
  if (isFiniteNumber(candidate.vignette)) patch.vignette = candidate.vignette;
  if (isFiniteNumber(candidate.chromaAberration)) patch.chromaAberration = candidate.chromaAberration;
  if (isFiniteNumber(candidate.temperature)) patch.temperature = candidate.temperature;
  if (isFiniteNumber(candidate.tint)) patch.tint = candidate.tint;
  if (isFiniteNumber(candidate.contrast)) patch.contrast = candidate.contrast;
  if (isFiniteNumber(candidate.saturation)) patch.saturation = candidate.saturation;
  if (isFiniteNumber(candidate.sharpen)) patch.sharpen = clamp(candidate.sharpen, 0, 1);
  if (isFiniteNumber(candidate.noiseReduction)) {
    patch.noiseReduction = clamp(candidate.noiseReduction, 0, 1);
  }
  if (typeof candidate.toneMap === "boolean") patch.toneMap = candidate.toneMap;
  if (isFiniteNumber(candidate.upscaleFactor)) patch.upscaleFactor = coerceUpscaleFactor(candidate.upscaleFactor);
  if (isFiniteNumber(candidate.previewScale)) patch.previewScale = parsePreviewScale(`${candidate.previewScale}`);
  if (
    candidate.previewMode === "original" ||
    candidate.previewMode === "processed" ||
    candidate.previewMode === "split"
  ) {
    patch.previewMode = candidate.previewMode;
  }
  if (isFiniteNumber(candidate.splitPosition)) patch.splitPosition = clamp(candidate.splitPosition, 0, 1);
  if (
    candidate.histogramMode === "original" ||
    candidate.histogramMode === "processed" ||
    candidate.histogramMode === "composite"
  ) {
    patch.histogramMode = candidate.histogramMode;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseUpscaleFactor(raw: string): UpscaleFactor {
  const parsed = Number(raw);
  return coerceUpscaleFactor(parsed);
}

function coerceUpscaleFactor(value: number): UpscaleFactor {
  if (value >= 4) {
    return 4;
  }
  if (value >= 3.5) {
    return 3.5;
  }
  if (value >= 3) {
    return 3;
  }
  if (value >= 2.5) {
    return 2.5;
  }
  if (value >= 2) {
    return 2;
  }
  if (value >= 1.5) {
    return 1.5;
  }
  return 1;
}

function parsePreviewScale(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  if (parsed <= 0.5) {
    return 0.5;
  }
  if (parsed <= 0.75) {
    return 0.75;
  }
  return 1;
}

function parseControlTheme(raw: string | null | undefined): ControlTheme {
  return raw === "camera" ? "camera" : "sliders";
}

function dialKindForKey(key: NumericParamKey): DialKind {
  if (key === "aperture") {
    return "aperture";
  }
  if (key === "focalLength") {
    return "lens-zoom";
  }
  if (key === "focusDistance") {
    return "lens-focus";
  }
  return "standard";
}

function findNearestValueIndex(values: readonly number[], target: number): number {
  if (values.length === 0) {
    return 0;
  }

  let bestIndex = 0;
  let bestDistance = Math.abs(values[0] - target);

  for (let i = 1; i < values.length; i += 1) {
    const distance = Math.abs(values[i] - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function dialAngleForIndex(index: number, valueCount: number): number {
  if (valueCount <= 1) {
    return 0;
  }

  const ratio = clamp(index / (valueCount - 1), 0, 1);
  return DIAL_MIN_ANGLE_DEG + ratio * DIAL_SWEEP_DEG;
}

function pointerAngleFromEvent(event: PointerEvent, dial: HTMLElement): number {
  const rect = dial.getBoundingClientRect();
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.5;
  const angleRad = Math.atan2(event.clientY - centerY, event.clientX - centerX);
  return (angleRad * 180) / Math.PI;
}

function shortestAngleDelta(startDeg: number, endDeg: number): number {
  let delta = endDeg - startDeg;
  while (delta > 180) {
    delta -= 360;
  }
  while (delta < -180) {
    delta += 360;
  }
  return delta;
}

function mapCanvasToImageUv(
  normalizedX: number,
  normalizedY: number,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number } | null {
  const imageAspect = imageWidth / imageHeight;
  const canvasAspect = canvasWidth / canvasHeight;

  let x = normalizedX;
  let y = normalizedY;

  if (canvasAspect > imageAspect) {
    const xScale = imageAspect / canvasAspect;
    x = (normalizedX - 0.5) / xScale + 0.5;
  } else {
    const yScale = canvasAspect / imageAspect;
    y = (normalizedY - 0.5) / yScale + 0.5;
  }

  if (x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }

  return { x, y };
}

function computeAutoExposure(luminance: number): number {
  const safeLuminance = Math.max(0.005, luminance);
  const targetLuminance = 0.38;
  return clamp(Math.log2(targetLuminance / safeLuminance), -3, 3);
}

function computeAutoFocusDistance(depthNorm: number): number {
  const focusNorm = clamp((depthNorm - 0.12) / (0.95 - 0.12), 0, 1);
  return 0.2 + focusNorm * (50 - 0.2);
}

function srgbToLinear(value: number): number {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return Math.pow((value + 0.055) / 1.055, 2.4);
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  if (canvas.toBlob) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, "image/png");
    });
  }

  return fetch(canvas.toDataURL("image/png"))
    .then((response) => response.blob())
    .catch(() => null);
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}
