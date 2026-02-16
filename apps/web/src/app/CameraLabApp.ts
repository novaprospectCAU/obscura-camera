import {
  CameraParamStore,
  DEFAULT_CAMERA_PARAMS,
  type CameraParams,
  type HistogramMode,
  type UpscaleFactor,
  type UpscaleStyle
} from "./state";
import {
  type HistogramData,
  type RendererSubjectContext,
  WebGLImageRenderer
} from "./gl/WebGLImageRenderer";

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
  | "upscaleStyle"
>;

type AiSuggestedPatch = Partial<
  Pick<
    CameraParams,
    | NumericParamKey
    | "toneMap"
    | "upscaleFactor"
    | "upscaleStyle"
  >
>;

type SubjectContext = {
  center: { x: number; y: number };
  box: { x: number; y: number; width: number; height: number };
  areaRatio: number;
  brightness: number;
  sharpness: number;
  offCenter: number;
  backlit: boolean;
};

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
  aiApiKeyInput: HTMLInputElement;
  aiPromptInput: HTMLTextAreaElement;
  aiApplyButton: HTMLButtonElement;
  previewOriginalButton: HTMLButtonElement;
  previewProcessedButton: HTMLButtonElement;
  previewSplitButton: HTMLButtonElement;
  splitControl: HTMLElement;
  splitSlider: HTMLInputElement;
  splitReadout: HTMLOutputElement;
  toneMapToggle: HTMLInputElement;
  upscaleSelect: HTMLSelectElement;
  upscaleStyleSelect: HTMLSelectElement;
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
const AI_API_KEY_STORAGE_KEY = "obscura.ai-api-key.v1";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4.1-mini";
const IDENTITY = (value: number): number => value;
const SHUTTER_MIN = 1 / 8000;
const SHUTTER_MAX = 1 / 15;
const DIAL_MIN_ANGLE_DEG = -140;
const DIAL_MAX_ANGLE_DEG = 140;
const DIAL_SWEEP_DEG = DIAL_MAX_ANGLE_DEG - DIAL_MIN_ANGLE_DEG;
const SUBJECT_ANALYSIS_INTERVAL_MS = 320;

const PARAM_VALUE_LIMITS: Record<NumericParamKey, { min: number; max: number }> = {
  exposureEV: { min: -3, max: 3 },
  shutter: { min: SHUTTER_MIN, max: SHUTTER_MAX },
  iso: { min: 100, max: 6400 },
  aperture: { min: 1.4, max: 22 },
  focalLength: { min: 18, max: 120 },
  focusDistance: { min: 0.2, max: 50 },
  distortion: { min: -0.5, max: 0.5 },
  vignette: { min: 0, max: 1 },
  chromaAberration: { min: 0, max: 1 },
  temperature: { min: -1, max: 1 },
  tint: { min: -1, max: 1 },
  contrast: { min: 0.5, max: 1.5 },
  saturation: { min: 0, max: 2 },
  sharpen: { min: 0, max: 1 },
  noiseReduction: { min: 0, max: 1 }
};

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
  private aiRequestInFlight = false;
  private latestSubjectContext: SubjectContext | null = null;
  private lastSubjectAnalysisMs = -Infinity;
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
          <p class="lead">Web camera lab: snapshot, custom presets, histogram modes, and session restore.</p>

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
            <p class="control-title">Custom Presets</p>
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
            <p class="control-title">AI Prompt</p>
            <label class="ai-row" for="ai-api-key-input">
              <span>OpenAI API Key</span>
              <input id="ai-api-key-input" type="password" placeholder="sk-..." autocomplete="off" />
            </label>
            <label class="ai-prompt-row" for="ai-prompt-input">
              <span>Prompt</span>
              <textarea id="ai-prompt-input" rows="3" placeholder="예: 영화 같은 차가운 야간 느낌으로 조정해줘. 노이즈는 줄이고 대비는 조금 올려줘."></textarea>
            </label>
            <button id="ai-apply-button" class="mini-button" type="button">Apply AI Prompt</button>
            <p class="hint">API key is stored in localStorage for this browser.</p>
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
            <label class="upscale-row" for="upscale-style-select">
              <span>Upscale Style</span>
              <select id="upscale-style-select">
                <option value="balanced">Balanced (match look)</option>
                <option value="enhanced">Enhanced (strong difference)</option>
              </select>
            </label>
            <p class="hint">Balanced keeps X1~X4 look stable, Enhanced increases texture/grain response.</p>
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
    this.bindAiControls();
    this.bindPreviewControls();
    this.bindControlTheme();
    this.bindMeteringControls();
    this.bindSnapshotControl();

    this.loadCustomPresets();
    this.rebuildPresetSelect();
    this.restoreAiApiKey();
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
      aiApiKeyInput: this.requireElement<HTMLInputElement>("#ai-api-key-input"),
      aiPromptInput: this.requireElement<HTMLTextAreaElement>("#ai-prompt-input"),
      aiApplyButton: this.requireElement<HTMLButtonElement>("#ai-apply-button"),
      previewOriginalButton: this.requireElement<HTMLButtonElement>("#preview-original"),
      previewProcessedButton: this.requireElement<HTMLButtonElement>("#preview-processed"),
      previewSplitButton: this.requireElement<HTMLButtonElement>("#preview-split"),
      splitControl: this.requireElement<HTMLElement>("#split-control"),
      splitSlider: this.requireElement<HTMLInputElement>("#split-slider"),
      splitReadout: this.requireElement<HTMLOutputElement>("#split-readout"),
      toneMapToggle: this.requireElement<HTMLInputElement>("#tone-map-toggle"),
      upscaleSelect: this.requireElement<HTMLSelectElement>("#upscale-select"),
      upscaleStyleSelect: this.requireElement<HTMLSelectElement>("#upscale-style-select"),
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

  private bindAiControls(): void {
    if (!this.elements) {
      return;
    }

    const { aiApiKeyInput, aiPromptInput, aiApplyButton } = this.elements;
    aiApiKeyInput.addEventListener("change", () => {
      writeStorage(AI_API_KEY_STORAGE_KEY, aiApiKeyInput.value.trim());
    });

    aiApplyButton.addEventListener("click", () => {
      void this.applyAiPrompt();
    });

    aiPromptInput.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void this.applyAiPrompt();
      }
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
      upscaleStyleSelect,
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
    upscaleStyleSelect.addEventListener("change", () => {
      const style = parseUpscaleStyle(upscaleStyleSelect.value);
      this.params.set("upscaleStyle", style);
      this.setStatus(
        style === "enhanced"
          ? "Upscale style: Enhanced (stronger texture/grain response)."
          : "Upscale style: Balanced (look-matched across scales)."
      );
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
    this.elements.upscaleStyleSelect.value = state.upscaleStyle;
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
      this.loadedImage = image;
      this.updateSubjectContextForRenderer(true);
      this.renderer.render();
      this.drawHistogram();

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
      this.updateSubjectContextForRenderer(true);
      this.refreshEmptyState();
      this.renderer.render();
      this.drawHistogram();
      this.setStatus(this.hasImage ? "Showing uploaded image." : "Waiting for image input.");
      return;
    }

    this.sourceMode = "webcam";
    const switchToken = ++this.sourceSwitchToken;
    this.latestSubjectContext = null;
    this.renderer.setSubjectContext(null);
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
      this.updateSubjectContextForRenderer(false);
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

    this.lastSubjectAnalysisMs = -Infinity;
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
      this.setStatus("No custom preset selected.");
      return;
    }

    const currentFocalLength = this.params.getState().focalLength;

    const preset = this.customPresets[parsed.name];
    if (!preset) {
      this.setStatus(`Custom preset not found: ${parsed.name}`);
      return;
    }

    this.params.patch({
      ...preset,
      focalLength: currentFocalLength
    });
    if (this.elements) {
      this.elements.presetNameInput.value = parsed.name;
    }
    this.setStatus(`Applied custom preset: ${parsed.name} (kept focal length).`);
  }

  private saveCurrentAsCustomPreset(requestedName: string): void {
    if (!this.elements) {
      return;
    }

    const currentSelection = this.parsePresetSelection(this.elements.presetSelect.value);
    const fallbackName = currentSelection ? currentSelection.name : "";
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
    const targetName = selected ? selected.name : fromInput;

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
    } else {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "No custom presets";
      select.append(emptyOption);
    }

    const hasPrevious = [...select.options].some((option) => option.value === previousValue);
    if (hasPrevious) {
      select.value = previousValue;
    } else {
      select.value = customNames.length > 0 ? `custom:${customNames[0]}` : "";
    }

    const hasCustom = customNames.length > 0;
    this.elements.presetApplyButton.disabled = !hasCustom;
    this.elements.presetDeleteButton.disabled = !hasCustom;
  }

  private parsePresetSelection(selection: string): { name: string } | null {
    if (selection.startsWith("custom:")) {
      const name = selection.slice("custom:".length);
      return name ? { name } : null;
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

  private restoreAiApiKey(): void {
    if (!this.elements) {
      return;
    }
    const apiKey = readStorage(AI_API_KEY_STORAGE_KEY);
    if (apiKey) {
      this.elements.aiApiKeyInput.value = apiKey;
    }
  }

  private setAiBusy(isBusy: boolean): void {
    if (!this.elements) {
      return;
    }

    this.elements.aiApplyButton.disabled = isBusy;
    this.elements.aiApplyButton.textContent = isBusy ? "Applying..." : "Apply AI Prompt";
  }

  private async applyAiPrompt(): Promise<void> {
    if (!this.elements || this.aiRequestInFlight) {
      return;
    }

    const apiKey = this.elements.aiApiKeyInput.value.trim();
    const prompt = this.elements.aiPromptInput.value.trim();
    const currentState = this.params.getState();

    if (!apiKey) {
      this.setStatus("Enter an OpenAI API key first.");
      return;
    }

    if (!prompt) {
      this.setStatus("Enter a prompt for AI adjustment.");
      return;
    }

    writeStorage(AI_API_KEY_STORAGE_KEY, apiKey);

    this.aiRequestInFlight = true;
    this.setAiBusy(true);
    this.setStatus("AI is generating camera adjustments...");

    try {
      const subjectContext = this.updateSubjectContextForRenderer(true);
      const aiResponse = await requestAiCameraPatch(apiKey, prompt, currentState, subjectContext);
      const candidatePatch = extractAiPatchCandidate(aiResponse.patch);
      let patch = sanitizeAiSuggestedPatch(candidatePatch);
      patch = ensureVisibleAiPatch(patch, prompt, currentState);

      if (!patch || Object.keys(patch).length === 0) {
        this.setStatus("AI response did not include applicable setting changes.");
        return;
      }

      patch = enforceAiPatchSafety(patch, prompt, currentState, subjectContext);

      if (Object.keys(patch).length === 0) {
        this.setStatus("AI changes were filtered by safety guards. Try a more explicit prompt.");
        return;
      }

      const finalPatch = filterChangedAiPatchFields(patch, currentState);
      if (!finalPatch || Object.keys(finalPatch).length === 0) {
        this.setStatus("AI returned near-identical values. Try a stronger style prompt.");
        return;
      }

      const changedKeys = Object.keys(finalPatch);
      const appliedState = this.params.getState();
      if (appliedState.previewMode === "original") {
        this.params.set("previewMode", "processed");
      }

      this.params.patch(finalPatch);
      const summary = aiResponse.summary?.trim();
      if (summary) {
        this.setStatus(
          subjectContext
            ? `AI applied (${changedKeys.join(", ")}): ${summary} [subject ${Math.round(subjectContext.center.x * 100)}%,${Math.round(subjectContext.center.y * 100)}%]`
            : `AI applied (${changedKeys.join(", ")}): ${summary}`
        );
      } else {
        this.setStatus(`AI applied ${changedKeys.length} setting(s): ${changedKeys.join(", ")}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown AI request error.";
      this.setStatus(`AI request failed: ${message}`);
    } finally {
      this.aiRequestInFlight = false;
      this.setAiBusy(false);
    }
  }

  private analyzeSubjectContext(): SubjectContext | null {
    const dims = this.getActiveSourceDimensions();
    const target = this.sourceMode === "webcam" ? this.webcamVideo : this.loadedImage;
    if (!dims || !target) {
      return null;
    }

    const maxSize = 128;
    const sourceAspect = dims.width / dims.height;
    const analysisWidth = Math.max(48, Math.min(maxSize, Math.round(sourceAspect >= 1 ? maxSize : maxSize * sourceAspect)));
    const analysisHeight = Math.max(48, Math.min(maxSize, Math.round(sourceAspect >= 1 ? maxSize / sourceAspect : maxSize)));

    this.meterCanvas.width = analysisWidth;
    this.meterCanvas.height = analysisHeight;
    const ctx = this.meterCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return null;
    }

    ctx.drawImage(target, 0, 0, analysisWidth, analysisHeight);
    const imageData = ctx.getImageData(0, 0, analysisWidth, analysisHeight);
    return estimateSubjectContext(imageData.data, analysisWidth, analysisHeight);
  }

  private updateSubjectContextForRenderer(force: boolean): SubjectContext | null {
    if (!this.renderer) {
      return null;
    }

    const now = performance.now();
    if (!force && now - this.lastSubjectAnalysisMs < SUBJECT_ANALYSIS_INTERVAL_MS) {
      if (this.latestSubjectContext) {
        this.renderer.setSubjectContext(toRendererSubjectContext(this.latestSubjectContext));
      }
      return this.latestSubjectContext;
    }

    this.lastSubjectAnalysisMs = now;
    const nextContext = this.analyzeSubjectContext();
    this.latestSubjectContext = nextContext;
    this.renderer.setSubjectContext(nextContext ? toRendererSubjectContext(nextContext) : null);
    return nextContext;
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
    toneMap: state.toneMap,
    upscaleStyle: state.upscaleStyle
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
  const upscaleStyle = parseUpscaleStyle(candidate.upscaleStyle);

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
    toneMap: candidate.toneMap,
    upscaleStyle
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
  if (typeof candidate.upscaleStyle === "string") {
    patch.upscaleStyle = parseUpscaleStyle(candidate.upscaleStyle);
  }
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

type AiPatchResponsePayload = {
  patch?: unknown;
  summary?: unknown;
  status?: unknown;
};

type OpenAiChatCompletionPayload = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

function sanitizeAiSuggestedPatch(value: unknown): AiSuggestedPatch | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const patch: AiSuggestedPatch = {};

  for (const [key, limits] of Object.entries(PARAM_VALUE_LIMITS) as Array<
    [NumericParamKey, { min: number; max: number }]
  >) {
    const nextValue = parseFlexibleNumber(candidate[key], key);
    if (nextValue === null) {
      continue;
    }
    patch[key] = clamp(nextValue, limits.min, limits.max);
  }

  const toneMap = parseFlexibleBoolean(candidate.toneMap);
  if (toneMap !== null) {
    patch.toneMap = toneMap;
  }
  const upscaleFactor = parseFlexibleNumber(candidate.upscaleFactor, "upscaleFactor");
  if (upscaleFactor !== null) {
    patch.upscaleFactor = coerceUpscaleFactor(upscaleFactor);
  }
  if (typeof candidate.upscaleStyle === "string") {
    patch.upscaleStyle = parseUpscaleStyle(candidate.upscaleStyle);
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function extractAiPatchCandidate(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const nestedPatchKeys = ["patch", "settings", "params", "cameraParams"];
  for (const key of nestedPatchKeys) {
    const nested = candidate[key];
    if (nested && typeof nested === "object") {
      return nested;
    }
  }

  const hasKnownField =
    Object.keys(PARAM_VALUE_LIMITS).some((key) => key in candidate) ||
    "toneMap" in candidate ||
    "upscaleFactor" in candidate ||
    "upscaleStyle" in candidate;
  return hasKnownField ? candidate : null;
}

function ensureVisibleAiPatch(
  patch: AiSuggestedPatch | null,
  prompt: string,
  current: Readonly<CameraParams>
): AiSuggestedPatch | null {
  const basePatch = patch ? { ...patch } : {};
  const meaningfulBase = filterChangedAiPatchFields(basePatch, current);
  if (meaningfulBase && Object.keys(meaningfulBase).length >= 2) {
    return basePatch;
  }

  const fallbackPatch = buildPromptFallbackPatch(prompt, current);
  if (!fallbackPatch) {
    return basePatch;
  }

  const mergedPatch: AiSuggestedPatch = {
    ...basePatch,
    ...fallbackPatch
  };
  return Object.keys(mergedPatch).length > 0 ? mergedPatch : null;
}

function filterChangedAiPatchFields(
  patch: AiSuggestedPatch | null,
  current: Readonly<CameraParams>
): AiSuggestedPatch | null {
  if (!patch) {
    return null;
  }

  const next: AiSuggestedPatch = {};
  for (const numericKey of Object.keys(PARAM_VALUE_LIMITS) as NumericParamKey[]) {
    const numericValue = patch[numericKey];
    if (!isFiniteNumber(numericValue)) {
      continue;
    }
    const currentValue = current[numericKey];
    if (!isMeaningfulNumericChange(numericKey, currentValue, numericValue)) {
      continue;
    }
    next[numericKey] = numericValue;
  }

  if (typeof patch.toneMap === "boolean" && patch.toneMap !== current.toneMap) {
    next.toneMap = patch.toneMap;
  }
  if (patch.upscaleStyle && patch.upscaleStyle !== current.upscaleStyle) {
    next.upscaleStyle = patch.upscaleStyle;
  }
  if (patch.upscaleFactor !== undefined && patch.upscaleFactor !== current.upscaleFactor) {
    next.upscaleFactor = patch.upscaleFactor;
  }

  return Object.keys(next).length > 0 ? next : null;
}

function isMeaningfulNumericChange(key: NumericParamKey, current: number, next: number): boolean {
  if (key === "shutter") {
    return Math.abs(toShutterSlider(next) - toShutterSlider(current)) >= 0.035;
  }

  const minDelta: Record<NumericParamKey, number> = {
    exposureEV: 0.07,
    shutter: 0.001,
    iso: 28,
    aperture: 0.2,
    focalLength: 2,
    focusDistance: 0.35,
    distortion: 0.03,
    vignette: 0.03,
    chromaAberration: 0.03,
    temperature: 0.03,
    tint: 0.03,
    contrast: 0.03,
    saturation: 0.04,
    sharpen: 0.035,
    noiseReduction: 0.04
  };
  return Math.abs(next - current) >= minDelta[key];
}

function buildPromptFallbackPatch(
  prompt: string,
  current: Readonly<CameraParams>
): AiSuggestedPatch | null {
  const normalized = prompt.toLowerCase();
  const patch: AiSuggestedPatch = {};
  let hitCount = 0;

  const hasAny = (keywords: string[]): boolean => keywords.some((keyword) => normalized.includes(keyword));
  const setDelta = (key: NumericParamKey, delta: number) => {
    const limits = PARAM_VALUE_LIMITS[key];
    patch[key] = clamp(current[key] + delta, limits.min, limits.max);
  };

  if (hasAny(["cinematic", "movie", "film", "filmic", "시네마", "영화"])) {
    setDelta("contrast", 0.14);
    setDelta("saturation", -0.12);
    setDelta("vignette", 0.2);
    patch.toneMap = true;
    hitCount += 1;
  }
  if (hasAny(["warm", "golden", "sunset", "따뜻", "웜", "노을"])) {
    setDelta("temperature", 0.32);
    setDelta("tint", 0.06);
    hitCount += 1;
  } else if (hasAny(["cool", "cold", "blue", "차갑", "쿨", "푸른"])) {
    setDelta("temperature", -0.34);
    setDelta("tint", -0.05);
    hitCount += 1;
  }
  if (hasAny(["bright", "clean", "high key", "밝", "쨍", "환하"])) {
    setDelta("exposureEV", 0.55);
    setDelta("contrast", 0.07);
    hitCount += 1;
  } else if (hasAny(["dark", "moody", "low key", "night", "어둡", "무드", "야간", "야경"])) {
    setDelta("exposureEV", -0.48);
    setDelta("contrast", 0.1);
    setDelta("vignette", 0.16);
    hitCount += 1;
  }
  if (hasAny(["vivid", "rich color", "생생", "강한 색", "채도"])) {
    setDelta("saturation", 0.22);
    hitCount += 1;
  } else if (hasAny(["muted", "matte", "desaturat", "바랜", "저채도", "무채"])) {
    setDelta("saturation", -0.24);
    hitCount += 1;
  }
  if (hasAny(["sharp", "detail", "crisp", "선명", "디테일"])) {
    setDelta("sharpen", 0.22);
    setDelta("noiseReduction", -0.16);
    hitCount += 1;
  } else if (hasAny(["soft", "dreamy", "hazy", "부드", "몽환"])) {
    setDelta("sharpen", -0.2);
    setDelta("noiseReduction", 0.2);
    hitCount += 1;
  }

  if (hitCount === 0) {
    setDelta("contrast", 0.1);
    setDelta("saturation", -0.08);
    setDelta("temperature", -0.06);
    patch.toneMap = true;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function parseFlexibleBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

function parseFlexibleNumber(
  value: unknown,
  key: NumericParamKey | "upscaleFactor"
): number | null {
  if (isFiniteNumber(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }

  let normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (key === "aperture") {
    normalized = normalized.replace(/^f\s*\/\s*/, "");
  } else if (key === "focalLength") {
    normalized = normalized.replace(/mm/g, "");
  } else if (key === "focusDistance") {
    normalized = normalized.replace(/m(?![a-z])/g, "");
  } else if (key === "upscaleFactor") {
    normalized = normalized.replace(/x/g, "");
  }

  normalized = normalized.replace(/,/g, "");

  const fraction = normalized.match(/(-?\d*\.?\d+)\s*\/\s*(-?\d*\.?\d+)/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return numerator / denominator;
    }
  }

  const numberMatch = normalized.match(/-?\d*\.?\d+/);
  if (!numberMatch) {
    return null;
  }

  const parsed = Number(numberMatch[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldAllowLensAdjustments(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const keywords = [
    "lens",
    "zoom",
    "focal",
    "focus",
    "depth of field",
    "렌즈",
    "줌",
    "화각",
    "초점",
    "포커스",
    "심도"
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function shouldAllowDepthOfFieldAdjustments(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const keywords = [
    "bokeh",
    "depth of field",
    "dof",
    "background blur",
    "shallow focus",
    "deep focus",
    "portrait",
    "macro",
    "보케",
    "심도",
    "아웃포커싱",
    "배경 흐림",
    "인물",
    "매크로"
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function shouldAllowShutterAdjustments(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const keywords = [
    "shutter",
    "motion blur",
    "long exposure",
    "light trail",
    "freeze motion",
    "slow shutter",
    "fast shutter",
    "셔터",
    "모션 블러",
    "장노출",
    "빛 궤적",
    "움직임 정지"
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function shouldAllowAggressiveExposureAdjustments(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const keywords = [
    "brighter",
    "darker",
    "underexpose",
    "overexpose",
    "high key",
    "low key",
    "silhouette",
    "dramatic light",
    "밝게",
    "어둡게",
    "과노출",
    "저노출",
    "하이키",
    "로우키",
    "실루엣"
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function shouldAllowEnhancedUpscale(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const keywords = [
    "enhanced",
    "strong difference",
    "texture",
    "grain",
    "gritty",
    "fine detail",
    "micro-contrast",
    "텍스처",
    "질감",
    "그레인",
    "디테일",
    "강한 차이",
    "선명 디테일"
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function shouldPreferLowNoise(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const keywords = [
    "clean",
    "low noise",
    "noise free",
    "noise-free",
    "denoise",
    "smooth",
    "clean image",
    "노이즈 줄",
    "노이즈 제거",
    "저노이즈",
    "깨끗",
    "매끈"
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function enforceAiPatchSafety(
  patch: AiSuggestedPatch,
  prompt: string,
  current: Readonly<CameraParams>,
  subjectContext: SubjectContext | null
): AiSuggestedPatch {
  const next: AiSuggestedPatch = { ...patch };

  const allowLens = shouldAllowLensAdjustments(prompt);
  const allowDof = shouldAllowDepthOfFieldAdjustments(prompt);
  const allowShutter = shouldAllowShutterAdjustments(prompt);
  const allowAggressiveExposure = shouldAllowAggressiveExposureAdjustments(prompt);

  if (!allowLens) {
    delete next.focalLength;
    delete next.focusDistance;
  }

  if (!allowDof) {
    delete next.aperture;
    delete next.focusDistance;
  }

  if (!allowShutter) {
    delete next.shutter;
  }

  if (isFiniteNumber(next.exposureEV)) {
    const deltaLimit = allowAggressiveExposure ? 0.9 : 0.35;
    const limited = clamp(
      next.exposureEV,
      current.exposureEV - deltaLimit,
      current.exposureEV + deltaLimit
    );
    next.exposureEV = clamp(limited, -1.8, 1.6);
  }

  if (subjectContext && isFiniteNumber(next.exposureEV)) {
    if (subjectContext.brightness >= 0.72) {
      next.exposureEV = Math.min(next.exposureEV, current.exposureEV + 0.1);
    } else if (subjectContext.brightness <= 0.2 && !allowAggressiveExposure) {
      next.exposureEV = Math.max(next.exposureEV, current.exposureEV - 0.1);
      next.exposureEV = Math.min(next.exposureEV, current.exposureEV + 0.45);
    }
  }

  if (!allowAggressiveExposure && next.toneMap === true && isFiniteNumber(next.exposureEV)) {
    next.exposureEV = Math.min(next.exposureEV, current.exposureEV + 0.25);
  }

  if (isFiniteNumber(next.exposureEV) && next.exposureEV > current.exposureEV + 0.3) {
    const baseContrast = isFiniteNumber(next.contrast) ? next.contrast : current.contrast;
    next.contrast = Math.min(baseContrast, 1.18);
  }

  const allowEnhanced = shouldAllowEnhancedUpscale(prompt) && !shouldPreferLowNoise(prompt);
  if (next.upscaleStyle === "enhanced" && !allowEnhanced) {
    next.upscaleStyle = "balanced";
  }

  if (next.upscaleStyle === "enhanced") {
    const currentNr = current.noiseReduction;
    const nextNr = isFiniteNumber(next.noiseReduction) ? next.noiseReduction : currentNr;
    next.noiseReduction = clamp(Math.max(nextNr, 0.38), 0, 1);
  }

  return next;
}

function estimateSubjectContext(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): SubjectContext | null {
  const pixelCount = width * height;
  if (pixelCount < 64) {
    return null;
  }

  const luminance = new Float32Array(pixelCount);
  const salience = new Float32Array(pixelCount);
  let avgLuminance = 0;

  for (let i = 0, p = 0; i < pixelCount; i += 1, p += 4) {
    const r = srgbToLinear(pixels[p] / 255);
    const g = srgbToLinear(pixels[p + 1] / 255);
    const b = srgbToLinear(pixels[p + 2] / 255);
    const l = clamp(r * 0.2126 + g * 0.7152 + b * 0.0722, 0, 1);
    luminance[i] = l;
    avgLuminance += l;
  }
  avgLuminance /= pixelCount;

  const sigma = 0.38;
  let energySum = 0;
  let weightedX = 0;
  let weightedY = 0;
  let salienceSum = 0;
  let salienceMax = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx = Math.abs(luminance[i + 1] - luminance[i - 1]);
      const gy = Math.abs(luminance[i + width] - luminance[i - width]);
      const gradient = gx + gy;
      const nx = (x + 0.5) / width - 0.5;
      const ny = (y + 0.5) / height - 0.5;
      const centerWeight = Math.exp(-((nx * nx + ny * ny) / (2 * sigma * sigma)));
      const energy = gradient * (0.58 + centerWeight * 0.42);

      salience[i] = energy;
      energySum += energy;
      weightedX += energy * (x + 0.5);
      weightedY += energy * (y + 0.5);
      salienceSum += energy;
      salienceMax = Math.max(salienceMax, energy);
    }
  }

  if (energySum <= 1e-6) {
    return {
      center: { x: 0.5, y: 0.5 },
      box: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
      areaRatio: 0.16,
      brightness: avgLuminance,
      sharpness: 0,
      offCenter: 0,
      backlit: false
    };
  }

  const centerXNorm = clamp(weightedX / energySum / width, 0, 1);
  const centerYNorm = clamp(weightedY / energySum / height, 0, 1);

  const interiorCount = Math.max(1, (width - 2) * (height - 2));
  const salienceMean = salienceSum / interiorCount;
  const threshold = salienceMean + (salienceMax - salienceMean) * 0.35;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let selectedCount = 0;
  let subjectLumSum = 0;
  let subjectSalienceSum = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      if (salience[i] < threshold) {
        continue;
      }

      selectedCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      subjectLumSum += luminance[i];
      subjectSalienceSum += salience[i];
    }
  }

  if (selectedCount < Math.max(24, Math.round(pixelCount * 0.012))) {
    const fallbackHalfW = Math.max(8, Math.round(width * 0.2));
    const fallbackHalfH = Math.max(8, Math.round(height * 0.2));
    const cx = Math.round(centerXNorm * (width - 1));
    const cy = Math.round(centerYNorm * (height - 1));
    minX = clamp(cx - fallbackHalfW, 0, width - 1);
    maxX = clamp(cx + fallbackHalfW, 0, width - 1);
    minY = clamp(cy - fallbackHalfH, 0, height - 1);
    maxY = clamp(cy + fallbackHalfH, 0, height - 1);
    selectedCount = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
    subjectLumSum = regionLuminanceMean(luminance, width, height, minX, minY, maxX, maxY) * selectedCount;
    subjectSalienceSum = salienceMean * selectedCount;
  }

  const padX = Math.max(1, Math.round((maxX - minX + 1) * 0.06));
  const padY = Math.max(1, Math.round((maxY - minY + 1) * 0.06));
  minX = clamp(minX - padX, 0, width - 1);
  maxX = clamp(maxX + padX, 0, width - 1);
  minY = clamp(minY - padY, 0, height - 1);
  maxY = clamp(maxY + padY, 0, height - 1);

  const boxWidthPx = Math.max(1, maxX - minX + 1);
  const boxHeightPx = Math.max(1, maxY - minY + 1);
  const box = {
    x: clamp(minX / width, 0, 1),
    y: clamp(minY / height, 0, 1),
    width: clamp(boxWidthPx / width, 0, 1),
    height: clamp(boxHeightPx / height, 0, 1)
  };

  const subjectBrightness = clamp(subjectLumSum / Math.max(1, selectedCount), 0, 1);
  const avgSubjectSalience = subjectSalienceSum / Math.max(1, selectedCount);
  const sharpness = clamp(avgSubjectSalience / 0.16, 0, 1);
  const areaRatio = clamp((boxWidthPx * boxHeightPx) / pixelCount, 0, 1);

  const expansion = 1.55;
  const expandedHalfW = Math.round((boxWidthPx * expansion) * 0.5);
  const expandedHalfH = Math.round((boxHeightPx * expansion) * 0.5);
  const centerPxX = Math.round((minX + maxX) * 0.5);
  const centerPxY = Math.round((minY + maxY) * 0.5);
  const exMinX = clamp(centerPxX - expandedHalfW, 0, width - 1);
  const exMaxX = clamp(centerPxX + expandedHalfW, 0, width - 1);
  const exMinY = clamp(centerPxY - expandedHalfH, 0, height - 1);
  const exMaxY = clamp(centerPxY + expandedHalfH, 0, height - 1);

  let ringLumSum = 0;
  let ringCount = 0;
  for (let y = exMinY; y <= exMaxY; y += 1) {
    for (let x = exMinX; x <= exMaxX; x += 1) {
      const insideSubject = x >= minX && x <= maxX && y >= minY && y <= maxY;
      if (insideSubject) {
        continue;
      }
      ringLumSum += luminance[y * width + x];
      ringCount += 1;
    }
  }
  const ringBrightness = ringCount > 0 ? ringLumSum / ringCount : avgLuminance;
  const backlit = ringBrightness - subjectBrightness > 0.11 && subjectBrightness < 0.6;
  const offCenter = clamp(
    Math.hypot(centerXNorm - 0.5, centerYNorm - 0.5) / 0.7071067811865476,
    0,
    1
  );

  return {
    center: {
      x: centerXNorm,
      y: centerYNorm
    },
    box,
    areaRatio,
    brightness: subjectBrightness,
    sharpness,
    offCenter,
    backlit
  };
}

function regionLuminanceMean(
  luminance: Float32Array,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): number {
  const x0 = clamp(minX, 0, width - 1);
  const y0 = clamp(minY, 0, height - 1);
  const x1 = clamp(maxX, 0, width - 1);
  const y1 = clamp(maxY, 0, height - 1);

  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      sum += luminance[y * width + x];
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function sanitizeSubjectContextForPrompt(subject: SubjectContext): SubjectContext {
  const round = (value: number): number => Number(value.toFixed(3));
  return {
    center: {
      x: round(clamp(subject.center.x, 0, 1)),
      y: round(clamp(subject.center.y, 0, 1))
    },
    box: {
      x: round(clamp(subject.box.x, 0, 1)),
      y: round(clamp(subject.box.y, 0, 1)),
      width: round(clamp(subject.box.width, 0.02, 1)),
      height: round(clamp(subject.box.height, 0.02, 1))
    },
    areaRatio: round(clamp(subject.areaRatio, 0, 1)),
    brightness: round(clamp(subject.brightness, 0, 1)),
    sharpness: round(clamp(subject.sharpness, 0, 1)),
    offCenter: round(clamp(subject.offCenter, 0, 1)),
    backlit: Boolean(subject.backlit)
  };
}

function toRendererSubjectContext(subject: SubjectContext): RendererSubjectContext {
  const quality = clamp(subject.sharpness * 0.55 + subject.areaRatio * 0.45, 0, 1);
  const strength = clamp(0.34 + quality * 0.66, 0.34, 1);
  return {
    center: {
      x: clamp(subject.center.x, 0, 1),
      y: clamp(subject.center.y, 0, 1)
    },
    box: {
      x: clamp(subject.box.x, 0, 1),
      y: clamp(subject.box.y, 0, 1),
      width: clamp(subject.box.width, 0.02, 1),
      height: clamp(subject.box.height, 0.02, 1)
    },
    strength
  };
}

async function requestAiCameraPatch(
  apiKey: string,
  prompt: string,
  state: Readonly<CameraParams>,
  subjectContext: SubjectContext | null
): Promise<{ patch: unknown; summary: string }> {
  const requestBody = {
    model: OPENAI_MODEL,
    temperature: 0.2,
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content: [
          "You are a camera look tuning assistant.",
          "Given the user's prompt and current camera state, produce clearly visible adjustments.",
          "Return valid JSON only with shape:",
          '{"patch":{"exposureEV":number,"shutter":number,"iso":number,"aperture":number,"focalLength":number,"focusDistance":number,"distortion":number,"vignette":number,"chromaAberration":number,"temperature":number,"tint":number,"contrast":number,"saturation":number,"sharpen":number,"noiseReduction":number,"toneMap":boolean,"upscaleFactor":number,"upscaleStyle":"balanced"|"enhanced"},"summary":"short text"}',
          "Change at least 3 fields unless user asks for minimal change.",
          "Respect ranges:",
          "exposureEV[-3..3], shutter[0.000125..0.066667], iso[100..6400], aperture[1.4..22], focalLength[18..120], focusDistance[0.2..50], distortion[-0.5..0.5], vignette[0..1], chromaAberration[0..1], temperature[-1..1], tint[-1..1], contrast[0.5..1.5], saturation[0..2], sharpen[0..1], noiseReduction[0..1], upscaleFactor in [1,1.5,2,2.5,3,3.5,4], upscaleStyle in [balanced,enhanced].",
          "Use subjectContext to protect subject exposure and apparent focus.",
          "If subjectContext.brightness is high, avoid brightening aggressively.",
          "If subjectContext.backlit is true, prefer modest EV increase and tone mapping over extreme contrast jumps.",
          "Keep exposure conservative by default; unless user explicitly requests brighter/darker look, keep exposureEV delta within +-0.35 from current.",
          "Do not change aperture/focusDistance unless user explicitly asks for depth-of-field or bokeh changes.",
          "Do not change shutter unless user explicitly asks for motion blur, long exposure, or shutter behavior.",
          "Default upscaleStyle to balanced.",
          "Use enhanced only if user explicitly asks for stronger texture/grain/detail and does not ask for a clean/low-noise image.",
          "Do not change focalLength or focusDistance unless the prompt explicitly asks for lens/zoom/focus/depth-of-field change."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          prompt,
          currentState: {
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
            toneMap: state.toneMap,
            upscaleFactor: state.upscaleFactor,
            upscaleStyle: state.upscaleStyle,
            subjectContext: subjectContext ? sanitizeSubjectContextForPrompt(subjectContext) : null
          },
          subjectContext: subjectContext ? sanitizeSubjectContextForPrompt(subjectContext) : null
        })
      }
    ]
  };

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const payload = (await response.json()) as OpenAiChatCompletionPayload;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `OpenAI request failed (${response.status}).`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI returned an empty response.");
  }

  let parsed: AiPatchResponsePayload;
  try {
    parsed = JSON.parse(content) as AiPatchResponsePayload;
  } catch {
    throw new Error("OpenAI response was not valid JSON.");
  }

  const summary =
    typeof parsed.summary === "string"
      ? parsed.summary
      : typeof parsed.status === "string"
        ? parsed.status
        : "";

  return {
    patch: parsed,
    summary
  };
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

function parseUpscaleStyle(raw: string | null | undefined): UpscaleStyle {
  return raw === "enhanced" ? "enhanced" : "balanced";
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
