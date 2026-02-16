import { DEFAULT_CAMERA_PARAMS, type CameraParams, type PreviewMode } from "../state";
import { PingPongFramebuffer } from "./PingPongFramebuffer";

const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aUv;

out vec2 vUv;

void main() {
  vUv = aUv;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const PASS_INPUT_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uSource;
uniform float uExposureEV;

out vec4 outColor;

void main() {
  vec3 color = texture(uSource, vUv).rgb;
  color *= exp2(uExposureEV);
  outColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

const PASS_LENS_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uInput;
uniform float uDistortion;
uniform float uFocalLength;
uniform float uChromaAberration;
uniform float uVignette;

out vec4 outColor;

const vec3 BG_COLOR = vec3(0.08, 0.09, 0.11);

bool outsideUv(vec2 uv) {
  return uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
}

vec2 applyLensUv(vec2 uv) {
  vec2 centered = uv - 0.5;
  float radius2 = dot(centered, centered);
  vec2 distortedUv = uv + centered * radius2 * (uDistortion * 0.7);

  float focalNorm = clamp((uFocalLength - 18.0) / (120.0 - 18.0), 0.0, 1.0);
  float zoom = mix(1.0, 2.2, focalNorm);
  return (distortedUv - 0.5) / zoom + 0.5;
}

vec3 sampleWithChroma(vec2 uv) {
  if (outsideUv(uv)) {
    return BG_COLOR;
  }

  vec2 centerDir = normalize((uv - 0.5) + vec2(1e-5));
  vec2 caOffset = centerDir * uChromaAberration * 0.0035;

  float r = texture(uInput, clamp(uv + caOffset, 0.0, 1.0)).r;
  float g = texture(uInput, uv).g;
  float b = texture(uInput, clamp(uv - caOffset, 0.0, 1.0)).b;
  return vec3(r, g, b);
}

void main() {
  vec2 lensUv = applyLensUv(vUv);
  if (outsideUv(lensUv)) {
    outColor = vec4(BG_COLOR, 1.0);
    return;
  }

  vec3 color = sampleWithChroma(lensUv);
  float radius = length(lensUv - 0.5) * 1.4142;
  float vignetteFactor = 1.0 - (uVignette * smoothstep(0.25, 1.0, radius));

  outColor = vec4(color * vignetteFactor, 1.0);
}
`;

const PASS_EFFECTS_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uInput;
uniform vec2 uResolution;
uniform float uShutter;
uniform float uIso;
uniform float uAperture;
uniform float uFocusDistance;
uniform float uToneMapEnabled;
uniform float uFrame;

out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 filmic(vec3 color) {
  vec3 x = max(vec3(0.0), color - 0.004);
  return (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
}

vec3 sampleInput(vec2 uv) {
  return texture(uInput, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
  float shutterNorm = clamp(
    (log(uShutter) - log(1.0 / 8000.0)) / (log(1.0 / 15.0) - log(1.0 / 8000.0)),
    0.0,
    1.0
  );
  float apertureNorm = clamp((uAperture - 1.4) / (22.0 - 1.4), 0.0, 1.0);
  float focusNorm = clamp((uFocusDistance - 0.2) / (50.0 - 0.2), 0.0, 1.0);

  float focusPlane = mix(0.12, 0.95, focusNorm);
  float sceneDepth = clamp(length(vUv - 0.5) * 1.8, 0.0, 1.0);
  float coc = abs(sceneDepth - focusPlane);
  float blurPixels = shutterNorm * 6.0 + coc * apertureNorm * 9.0;

  vec2 blurStepX = vec2(blurPixels / uResolution.x, 0.0);
  vec2 blurStepY = vec2(0.0, blurPixels / uResolution.y);

  vec3 color = sampleInput(vUv) * 0.24;
  color += sampleInput(vUv - blurStepX * 2.0) * 0.10;
  color += sampleInput(vUv - blurStepX) * 0.15;
  color += sampleInput(vUv + blurStepX) * 0.15;
  color += sampleInput(vUv + blurStepX * 2.0) * 0.10;
  color += sampleInput(vUv - blurStepY) * 0.13;
  color += sampleInput(vUv + blurStepY) * 0.13;

  float isoNorm = clamp((uIso - 100.0) / (6400.0 - 100.0), 0.0, 1.0);
  float grain = hash12(gl_FragCoord.xy + vec2(uFrame * 0.173, uFrame * 0.319)) - 0.5;
  color += grain * (isoNorm * 0.12) * (0.35 + color);

  if (uToneMapEnabled > 0.5) {
    color = filmic(color);
  }

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const COMPOSITE_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uOriginal;
uniform sampler2D uProcessed;
uniform vec2 uImageSize;
uniform vec2 uCanvasSize;
uniform float uPreviewMode;
uniform float uSplitPosition;

out vec4 outColor;

const vec3 BG_COLOR = vec3(0.08, 0.09, 0.11);

bool outsideUv(vec2 uv) {
  return uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
}

vec2 getContainedUv(vec2 uv) {
  float imageAspect = uImageSize.x / uImageSize.y;
  float canvasAspect = uCanvasSize.x / uCanvasSize.y;

  if (canvasAspect > imageAspect) {
    float xScale = imageAspect / canvasAspect;
    float x = (uv.x - 0.5) / xScale + 0.5;
    return vec2(x, uv.y);
  }

  float yScale = canvasAspect / imageAspect;
  float y = (uv.y - 0.5) / yScale + 0.5;
  return vec2(uv.x, y);
}

void main() {
  vec2 containedUv = getContainedUv(vUv);
  if (outsideUv(containedUv)) {
    outColor = vec4(BG_COLOR, 1.0);
    return;
  }

  vec3 originalColor = texture(uOriginal, containedUv).rgb;
  vec3 processedColor = texture(uProcessed, containedUv).rgb;
  vec3 finalColor = processedColor;

  if (uPreviewMode < 0.5) {
    finalColor = originalColor;
  } else if (uPreviewMode > 1.5) {
    finalColor = vUv.x < uSplitPosition ? originalColor : processedColor;
    float splitLine = abs(vUv.x - uSplitPosition);
    if (splitLine < (1.0 / uCanvasSize.x)) {
      finalColor = mix(finalColor, vec3(0.96), 0.75);
    }
  }

  outColor = vec4(finalColor, 1.0);
}
`;

export class WebGLImageRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly sourceTexture: WebGLTexture;
  private readonly pingPong: PingPongFramebuffer;

  private readonly inputProgram: WebGLProgram;
  private readonly lensProgram: WebGLProgram;
  private readonly effectsProgram: WebGLProgram;
  private readonly compositeProgram: WebGLProgram;

  private readonly inputSourceUniform: WebGLUniformLocation;
  private readonly inputExposureUniform: WebGLUniformLocation;

  private readonly lensInputUniform: WebGLUniformLocation;
  private readonly lensDistortionUniform: WebGLUniformLocation;
  private readonly lensFocalLengthUniform: WebGLUniformLocation;
  private readonly lensChromaUniform: WebGLUniformLocation;
  private readonly lensVignetteUniform: WebGLUniformLocation;

  private readonly effectsInputUniform: WebGLUniformLocation;
  private readonly effectsResolutionUniform: WebGLUniformLocation;
  private readonly effectsShutterUniform: WebGLUniformLocation;
  private readonly effectsIsoUniform: WebGLUniformLocation;
  private readonly effectsApertureUniform: WebGLUniformLocation;
  private readonly effectsFocusDistanceUniform: WebGLUniformLocation;
  private readonly effectsToneMapUniform: WebGLUniformLocation;
  private readonly effectsFrameUniform: WebGLUniformLocation;

  private readonly compositeOriginalUniform: WebGLUniformLocation;
  private readonly compositeProcessedUniform: WebGLUniformLocation;
  private readonly compositeImageSizeUniform: WebGLUniformLocation;
  private readonly compositeCanvasSizeUniform: WebGLUniformLocation;
  private readonly compositePreviewModeUniform: WebGLUniformLocation;
  private readonly compositeSplitPositionUniform: WebGLUniformLocation;

  private sourceWidth = 1;
  private sourceHeight = 1;
  private frameIndex = 0;
  private params: CameraParams = { ...DEFAULT_CAMERA_PARAMS };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true
    });
    if (!gl) {
      throw new Error("WebGL2 is unavailable in this browser.");
    }
    this.gl = gl;

    this.vao = this.createFullscreenQuad();
    this.sourceTexture = this.createTexture();
    this.pingPong = new PingPongFramebuffer(gl);

    this.inputProgram = this.createProgram(VERTEX_SHADER_SOURCE, PASS_INPUT_FRAGMENT_SOURCE);
    this.lensProgram = this.createProgram(VERTEX_SHADER_SOURCE, PASS_LENS_FRAGMENT_SOURCE);
    this.effectsProgram = this.createProgram(VERTEX_SHADER_SOURCE, PASS_EFFECTS_FRAGMENT_SOURCE);
    this.compositeProgram = this.createProgram(VERTEX_SHADER_SOURCE, COMPOSITE_FRAGMENT_SOURCE);

    this.inputSourceUniform = this.requireUniform(this.inputProgram, "uSource");
    this.inputExposureUniform = this.requireUniform(this.inputProgram, "uExposureEV");

    this.lensInputUniform = this.requireUniform(this.lensProgram, "uInput");
    this.lensDistortionUniform = this.requireUniform(this.lensProgram, "uDistortion");
    this.lensFocalLengthUniform = this.requireUniform(this.lensProgram, "uFocalLength");
    this.lensChromaUniform = this.requireUniform(this.lensProgram, "uChromaAberration");
    this.lensVignetteUniform = this.requireUniform(this.lensProgram, "uVignette");

    this.effectsInputUniform = this.requireUniform(this.effectsProgram, "uInput");
    this.effectsResolutionUniform = this.requireUniform(this.effectsProgram, "uResolution");
    this.effectsShutterUniform = this.requireUniform(this.effectsProgram, "uShutter");
    this.effectsIsoUniform = this.requireUniform(this.effectsProgram, "uIso");
    this.effectsApertureUniform = this.requireUniform(this.effectsProgram, "uAperture");
    this.effectsFocusDistanceUniform = this.requireUniform(this.effectsProgram, "uFocusDistance");
    this.effectsToneMapUniform = this.requireUniform(this.effectsProgram, "uToneMapEnabled");
    this.effectsFrameUniform = this.requireUniform(this.effectsProgram, "uFrame");

    this.compositeOriginalUniform = this.requireUniform(this.compositeProgram, "uOriginal");
    this.compositeProcessedUniform = this.requireUniform(this.compositeProgram, "uProcessed");
    this.compositeImageSizeUniform = this.requireUniform(this.compositeProgram, "uImageSize");
    this.compositeCanvasSizeUniform = this.requireUniform(this.compositeProgram, "uCanvasSize");
    this.compositePreviewModeUniform = this.requireUniform(this.compositeProgram, "uPreviewMode");
    this.compositeSplitPositionUniform = this.requireUniform(this.compositeProgram, "uSplitPosition");

    this.initializeSourceTexture();
  }

  setParams(params: Readonly<CameraParams>): void {
    this.params = { ...params };
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.render();
  }

  setImage(image: HTMLImageElement): void {
    const width = Math.max(1, image.naturalWidth || 1);
    const height = Math.max(1, image.naturalHeight || 1);
    this.ensureSourceSize(width, height);

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 1);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      image
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  setVideoSource(video: HTMLVideoElement): void {
    const width = Math.max(1, video.videoWidth || 1);
    const height = Math.max(1, video.videoHeight || 1);
    this.ensureSourceSize(width, height);

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 1);
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      0,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      video
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  updateVideoFrame(video: HTMLVideoElement): void {
    const width = Math.max(1, video.videoWidth || 1);
    const height = Math.max(1, video.videoHeight || 1);
    this.ensureSourceSize(width, height);

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 1);
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      0,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      video
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  render(): void {
    this.runInputPass();
    this.runLensPass();
    this.runEffectsPass();
    this.runCompositePass();
    this.frameIndex += 1;
  }

  private runInputPass(): void {
    const target = this.pingPong.getA();

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
    this.gl.viewport(0, 0, this.sourceWidth, this.sourceHeight);
    this.gl.useProgram(this.inputProgram);
    this.gl.bindVertexArray(this.vao);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.uniform1i(this.inputSourceUniform, 0);
    this.gl.uniform1f(this.inputExposureUniform, this.params.exposureEV);

    this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.bindVertexArray(null);
    this.gl.useProgram(null);
  }

  private runLensPass(): void {
    const read = this.pingPong.getA();
    const write = this.pingPong.getB();

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, write.framebuffer);
    this.gl.viewport(0, 0, this.sourceWidth, this.sourceHeight);
    this.gl.useProgram(this.lensProgram);
    this.gl.bindVertexArray(this.vao);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, read.texture);
    this.gl.uniform1i(this.lensInputUniform, 0);
    this.gl.uniform1f(this.lensDistortionUniform, this.params.distortion);
    this.gl.uniform1f(this.lensFocalLengthUniform, this.params.focalLength);
    this.gl.uniform1f(this.lensChromaUniform, this.params.chromaAberration);
    this.gl.uniform1f(this.lensVignetteUniform, this.params.vignette);

    this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.bindVertexArray(null);
    this.gl.useProgram(null);
  }

  private runEffectsPass(): void {
    const read = this.pingPong.getB();
    const write = this.pingPong.getA();

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, write.framebuffer);
    this.gl.viewport(0, 0, this.sourceWidth, this.sourceHeight);
    this.gl.useProgram(this.effectsProgram);
    this.gl.bindVertexArray(this.vao);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, read.texture);
    this.gl.uniform1i(this.effectsInputUniform, 0);
    this.gl.uniform2f(this.effectsResolutionUniform, this.sourceWidth, this.sourceHeight);
    this.gl.uniform1f(this.effectsShutterUniform, this.params.shutter);
    this.gl.uniform1f(this.effectsIsoUniform, this.params.iso);
    this.gl.uniform1f(this.effectsApertureUniform, this.params.aperture);
    this.gl.uniform1f(this.effectsFocusDistanceUniform, this.params.focusDistance);
    this.gl.uniform1f(this.effectsToneMapUniform, this.params.toneMap ? 1 : 0);
    this.gl.uniform1f(this.effectsFrameUniform, this.frameIndex);

    this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.bindVertexArray(null);
    this.gl.useProgram(null);
  }

  private runCompositePass(): void {
    const processed = this.pingPong.getA();

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clearColor(0.08, 0.09, 0.11, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.useProgram(this.compositeProgram);
    this.gl.bindVertexArray(this.vao);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.uniform1i(this.compositeOriginalUniform, 0);

    this.gl.activeTexture(this.gl.TEXTURE1);
    this.gl.bindTexture(this.gl.TEXTURE_2D, processed.texture);
    this.gl.uniform1i(this.compositeProcessedUniform, 1);

    this.gl.uniform2f(this.compositeImageSizeUniform, this.sourceWidth, this.sourceHeight);
    this.gl.uniform2f(this.compositeCanvasSizeUniform, this.canvas.width, this.canvas.height);
    this.gl.uniform1f(
      this.compositePreviewModeUniform,
      this.previewModeToUniform(this.params.previewMode)
    );
    this.gl.uniform1f(this.compositeSplitPositionUniform, this.params.splitPosition);

    this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.bindVertexArray(null);
    this.gl.useProgram(null);
  }

  private initializeSourceTexture(): void {
    this.ensureSourceSize(1, 1);
    const initialPixel = new Uint8Array([20, 23, 28, 255]);

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      1,
      1,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      initialPixel
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  private ensureSourceSize(width: number, height: number): void {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    if (safeWidth === this.sourceWidth && safeHeight === this.sourceHeight) {
      return;
    }

    this.sourceWidth = safeWidth;
    this.sourceHeight = safeHeight;

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      safeWidth,
      safeHeight,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null
    );
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);

    this.pingPong.resize(safeWidth, safeHeight);
  }

  private previewModeToUniform(mode: PreviewMode): number {
    if (mode === "original") {
      return 0;
    }
    if (mode === "processed") {
      return 1;
    }
    return 2;
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
    const program = this.gl.createProgram();

    if (!program) {
      throw new Error("Failed to create WebGL program.");
    }

    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);

    const isLinked = this.gl.getProgramParameter(program, this.gl.LINK_STATUS);
    if (!isLinked) {
      const error = this.gl.getProgramInfoLog(program) ?? "Unknown link error.";
      throw new Error(`Failed to link WebGL program: ${error}`);
    }

    this.gl.deleteShader(vertexShader);
    this.gl.deleteShader(fragmentShader);
    return program;
  }

  private createShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error("Failed to create WebGL shader.");
    }

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    const isCompiled = this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS);
    if (!isCompiled) {
      const error = this.gl.getShaderInfoLog(shader) ?? "Unknown compile error.";
      throw new Error(`Failed to compile WebGL shader: ${error}`);
    }

    return shader;
  }

  private createFullscreenQuad(): WebGLVertexArrayObject {
    const vao = this.gl.createVertexArray();
    if (!vao) {
      throw new Error("Failed to create vertex array object.");
    }

    const positions = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    const positionBuffer = this.gl.createBuffer();
    const uvBuffer = this.gl.createBuffer();
    const indexBuffer = this.gl.createBuffer();

    if (!positionBuffer || !uvBuffer || !indexBuffer) {
      throw new Error("Failed to allocate WebGL buffers.");
    }

    this.gl.bindVertexArray(vao);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, uvBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, uvs, this.gl.STATIC_DRAW);
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, 0, 0);

    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, indices, this.gl.STATIC_DRAW);

    this.gl.bindVertexArray(null);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);

    return vao;
  }

  private createTexture(): WebGLTexture {
    const texture = this.gl.createTexture();
    if (!texture) {
      throw new Error("Failed to create texture.");
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);

    return texture;
  }

  private requireUniform(program: WebGLProgram, name: string): WebGLUniformLocation {
    const uniform = this.gl.getUniformLocation(program, name);
    if (!uniform) {
      throw new Error(`Missing required uniform: ${name}`);
    }

    return uniform;
  }
}

