import {
  CAMERA_PRESETS,
  CameraParamStore,
  DEFAULT_CAMERA_PARAMS,
  type CameraParams,
  type CameraPresetName
} from "./state";
import { WebGLImageRenderer } from "./gl/WebGLImageRenderer";

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
  | "chromaAberration";

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

type AppElements = {
  canvas: HTMLCanvasElement;
  fileInput: HTMLInputElement;
  imageSourceButton: HTMLButtonElement;
  webcamSourceButton: HTMLButtonElement;
  presetSelect: HTMLSelectElement;
  presetApplyButton: HTMLButtonElement;
  presetResetButton: HTMLButtonElement;
  previewOriginalButton: HTMLButtonElement;
  previewProcessedButton: HTMLButtonElement;
  previewSplitButton: HTMLButtonElement;
  splitControl: HTMLElement;
  splitSlider: HTMLInputElement;
  splitReadout: HTMLOutputElement;
  toneMapToggle: HTMLInputElement;
  paramControls: HTMLElement;
  fileName: HTMLElement;
  status: HTMLElement;
  previewPanel: HTMLElement;
  emptyState: HTMLElement;
};

const IDENTITY = (value: number): number => value;
const SHUTTER_MIN = 1 / 8000;
const SHUTTER_MAX = 1 / 15;

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
  }
];

export class CameraLabApp {
  private readonly root: HTMLElement;
  private readonly params = new CameraParamStore(DEFAULT_CAMERA_PARAMS);
  private readonly sliderBindings: SliderBinding[] = [];
  private renderer?: WebGLImageRenderer;
  private elements?: AppElements;
  private sourceMode: SourceMode = "image";
  private hasImage = false;
  private webcamStream?: MediaStream;
  private webcamVideo?: HTMLVideoElement;
  private webcamFrameHandle?: number;
  private sourceSwitchToken = 0;

  private readonly onResize = () => {
    this.renderer?.resize();
  };

  private readonly blockWindowDrop = (event: DragEvent) => {
    event.preventDefault();
  };

  private readonly onPageHide = () => {
    this.disableWebcam();
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
            T4 implementation: source switch + parameter system + preview controls.
          </p>

          <section class="control-block">
            <p class="control-title">Source</p>
            <div class="source-toggle" role="group" aria-label="Source Select">
              <button id="source-image" class="source-button is-active" type="button">Image</button>
              <button id="source-webcam" class="source-button" type="button">Webcam</button>
            </div>

            <label class="file-button" for="file-input">Choose Image</label>
            <input id="file-input" type="file" accept="image/*" />
            <p class="hint">You can also drag and drop an image file onto the preview area.</p>
          </section>

          <section class="control-block">
            <p class="control-title">Presets</p>
            <div class="preset-row">
              <select id="preset-select">
                <option value="Portrait">Portrait</option>
                <option value="Landscape">Landscape</option>
                <option value="Night">Night</option>
              </select>
              <button id="preset-apply" class="mini-button" type="button">Apply</button>
              <button id="preset-reset" class="mini-button is-muted" type="button">Reset</button>
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
              <input id="tone-map-toggle" type="checkbox" checked />
            </label>
          </section>

          <section class="control-block param-section">
            <p class="control-title">Camera Parameters</p>
            <div id="param-controls" class="param-controls"></div>
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
    this.bindFileInput();
    this.bindDragAndDrop();
    this.bindSourceButtons();
    this.bindPresetControls();
    this.bindPreviewControls();

    this.params.subscribe((state) => {
      this.renderer?.setParams(state);
      this.syncParameterControls(state);
      this.syncPreviewControls(state);

      if (this.sourceMode !== "webcam" || !this.webcamVideo) {
        this.renderer?.render();
      }
    });

    window.addEventListener("resize", this.onResize);
    window.addEventListener("dragover", this.blockWindowDrop);
    window.addEventListener("drop", this.blockWindowDrop);
    window.addEventListener("pagehide", this.onPageHide);

    this.renderer.resize();
    this.refreshEmptyState();
    this.renderer.render();
  }

  private collectElements(): AppElements {
    return {
      canvas: this.requireElement<HTMLCanvasElement>("#preview-canvas"),
      fileInput: this.requireElement<HTMLInputElement>("#file-input"),
      imageSourceButton: this.requireElement<HTMLButtonElement>("#source-image"),
      webcamSourceButton: this.requireElement<HTMLButtonElement>("#source-webcam"),
      presetSelect: this.requireElement<HTMLSelectElement>("#preset-select"),
      presetApplyButton: this.requireElement<HTMLButtonElement>("#preset-apply"),
      presetResetButton: this.requireElement<HTMLButtonElement>("#preset-reset"),
      previewOriginalButton: this.requireElement<HTMLButtonElement>("#preview-original"),
      previewProcessedButton: this.requireElement<HTMLButtonElement>("#preview-processed"),
      previewSplitButton: this.requireElement<HTMLButtonElement>("#preview-split"),
      splitControl: this.requireElement<HTMLElement>("#split-control"),
      splitSlider: this.requireElement<HTMLInputElement>("#split-slider"),
      splitReadout: this.requireElement<HTMLOutputElement>("#split-readout"),
      toneMapToggle: this.requireElement<HTMLInputElement>("#tone-map-toggle"),
      paramControls: this.requireElement<HTMLElement>("#param-controls"),
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

  private bindPresetControls(): void {
    if (!this.elements) {
      return;
    }

    const { presetApplyButton, presetResetButton, presetSelect, status } = this.elements;

    presetApplyButton.addEventListener("click", () => {
      const presetName = presetSelect.value as CameraPresetName;
      this.params.patch(CAMERA_PRESETS[presetName]);
      status.textContent = `Applied ${presetName} preset.`;
    });

    presetResetButton.addEventListener("click", () => {
      this.params.reset();
      status.textContent = "Reset to default parameters.";
    });
  }

  private bindPreviewControls(): void {
    if (!this.elements) {
      return;
    }

    this.elements.previewOriginalButton.addEventListener("click", () => {
      this.params.set("previewMode", "original");
    });
    this.elements.previewProcessedButton.addEventListener("click", () => {
      this.params.set("previewMode", "processed");
    });
    this.elements.previewSplitButton.addEventListener("click", () => {
      this.params.set("previewMode", "split");
    });
    this.elements.splitSlider.addEventListener("input", () => {
      this.params.set("splitPosition", clamp(Number(this.elements?.splitSlider.value ?? 0.5), 0, 1));
    });
    this.elements.toneMapToggle.addEventListener("change", () => {
      this.params.set("toneMap", Boolean(this.elements?.toneMapToggle.checked));
    });
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

    const splitPercent = Math.round(state.splitPosition * 100);
    this.elements.splitReadout.textContent = `${splitPercent}%`;
    this.elements.splitSlider.value = `${state.splitPosition}`;
    this.elements.splitControl.classList.toggle("is-hidden", state.previewMode !== "split");
    this.elements.toneMapToggle.checked = state.toneMap;
  }

  private async loadIntoRenderer(file: File): Promise<void> {
    if (!this.renderer || !this.elements) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      this.elements.status.textContent = "Only image files are supported.";
      return;
    }

    this.elements.status.textContent = "Loading image...";

    try {
      const image = await this.loadImageFile(file);

      this.sourceSwitchToken += 1;
      this.disableWebcam();
      this.sourceMode = "image";
      this.updateSourceButtons();

      this.renderer.setImage(image);
      this.renderer.render();

      this.hasImage = true;
      this.elements.fileName.textContent = file.name;
      this.elements.status.textContent = `Loaded ${file.name}`;
      this.refreshEmptyState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown loading error.";
      this.elements.status.textContent = `Failed to load image: ${message}`;
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
      this.elements.status.textContent = this.hasImage
        ? "Showing uploaded image."
        : "Waiting for image input.";
      return;
    }

    this.sourceMode = "webcam";
    const switchToken = ++this.sourceSwitchToken;
    this.updateSourceButtons();
    this.refreshEmptyState();
    this.elements.status.textContent = "Requesting webcam permission...";

    try {
      await this.startWebcam();
      if (switchToken !== this.sourceSwitchToken || this.sourceMode !== "webcam") {
        this.disableWebcam();
        return;
      }

      this.elements.status.textContent = "Webcam active.";
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
      this.elements.status.textContent = `Webcam unavailable: ${message}`;
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

  private requireElement<T extends Element>(selector: string): T {
    const node = this.root.querySelector(selector);
    if (!node) {
      throw new Error(`Missing required element: ${selector}`);
    }

    return node as T;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
