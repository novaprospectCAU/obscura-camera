import { WebGLImageRenderer } from "./gl/WebGLImageRenderer";

type SourceMode = "image" | "webcam";

type AppElements = {
  canvas: HTMLCanvasElement;
  fileInput: HTMLInputElement;
  imageSourceButton: HTMLButtonElement;
  webcamSourceButton: HTMLButtonElement;
  fileName: HTMLElement;
  status: HTMLElement;
  previewPanel: HTMLElement;
  emptyState: HTMLElement;
};

export class CameraLabApp {
  private readonly root: HTMLElement;
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
            T3 implementation: switch between uploaded image and live webcam preview.
          </p>

          <div class="source-toggle" role="group" aria-label="Source Select">
            <button id="source-image" class="source-button is-active" type="button">Image</button>
            <button id="source-webcam" class="source-button" type="button">Webcam</button>
          </div>

          <label class="file-button" for="file-input">Choose Image</label>
          <input id="file-input" type="file" accept="image/*" />

          <p class="hint">You can also drag and drop an image file onto the preview area.</p>
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

    this.bindFileInput();
    this.bindDragAndDrop();
    this.bindSourceButtons();

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
      fileName: this.requireElement<HTMLElement>("#file-name"),
      status: this.requireElement<HTMLElement>("#status"),
      previewPanel: this.requireElement<HTMLElement>("#preview-panel"),
      emptyState: this.requireElement<HTMLElement>("#empty-state")
    };
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
