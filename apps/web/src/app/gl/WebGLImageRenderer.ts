import {
  DEFAULT_CAMERA_PARAMS,
  type CameraParams,
  type PreviewMode,
  type UpscaleFactor
} from "../state";
import { PingPongFramebuffer } from "./PingPongFramebuffer";

export type HistogramData = {
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  maxBin: number;
  version: number;
};

export type RendererSubjectContext = {
  center: { x: number; y: number };
  box: { x: number; y: number; width: number; height: number };
  strength: number;
};

const HISTOGRAM_BINS = 64;
const HISTOGRAM_SIZE = 128;
const HISTOGRAM_INTERVAL_MS = 200;
const DEFAULT_MAX_PROCESS_PIXELS = 32_000_000;
const DEFAULT_SUBJECT_CONTEXT: RendererSubjectContext = {
  center: { x: 0.5, y: 0.5 },
  box: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
  strength: 0
};

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
uniform vec2 uLensShift;
uniform vec2 uSubjectCenter;
uniform float uSubjectStrength;

out vec4 outColor;

const vec3 BG_COLOR = vec3(0.08, 0.09, 0.11);

bool outsideUv(vec2 uv) {
  return uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
}

vec2 applyLensUv(vec2 uv) {
  vec2 lensCenter = clamp(vec2(0.5) + uLensShift, vec2(0.02), vec2(0.98));
  vec2 centered = uv - lensCenter;
  float radius2 = dot(centered, centered);
  vec2 distortedUv = uv + centered * radius2 * (uDistortion * 0.7);

  float focalNorm = clamp((uFocalLength - 18.0) / (120.0 - 18.0), 0.0, 1.0);
  float zoom = mix(1.0, 2.2, focalNorm);
  return (distortedUv - lensCenter) / zoom + lensCenter;
}

vec3 sampleWithChroma(vec2 uv) {
  if (outsideUv(uv)) {
    return BG_COLOR;
  }

  vec2 lensCenter = clamp(vec2(0.5) + uLensShift, vec2(0.02), vec2(0.98));
  vec2 centerDir = normalize((uv - lensCenter) + vec2(1e-5));
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
  vec2 lensCenter = clamp(vec2(0.5) + uLensShift, vec2(0.02), vec2(0.98));
  float subjectBlend = clamp(uSubjectStrength * 0.62, 0.0, 1.0);
  vec2 vignetteCenter = mix(
    lensCenter,
    clamp(uSubjectCenter, 0.0, 1.0),
    subjectBlend
  );
  float radius = length(lensUv - vignetteCenter) * 1.4142;
  float vignetteFactor = 1.0 - (uVignette * smoothstep(0.25, 1.0, radius));

  outColor = vec4(color * vignetteFactor, 1.0);
}
`;

const PASS_EFFECTS_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uInput;
uniform vec2 uResolution;
uniform vec2 uEffectScale;
uniform float uUpscaleStyle;
uniform float uShutter;
uniform float uIso;
uniform float uAperture;
uniform float uFocusDistance;
uniform vec2 uLensShift;
uniform float uTemperature;
uniform float uTint;
uniform float uContrast;
uniform float uSaturation;
uniform float uSharpen;
uniform float uNoiseReduction;
uniform float uToneMapEnabled;
uniform float uFrame;
uniform vec2 uSubjectCenter;
uniform vec4 uSubjectBox;
uniform float uSubjectStrength;

out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 filmic(vec3 color) {
  vec3 x = max(vec3(0.0), color * 0.86 - 0.004);
  return (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
}

vec3 sampleInput(vec2 uv) {
  return texture(uInput, clamp(uv, 0.0, 1.0)).rgb;
}

vec3 crossBlur(vec2 uv, vec2 step) {
  vec3 sum = sampleInput(uv) * 0.4;
  sum += sampleInput(uv + vec2(step.x, 0.0)) * 0.15;
  sum += sampleInput(uv - vec2(step.x, 0.0)) * 0.15;
  sum += sampleInput(uv + vec2(0.0, step.y)) * 0.15;
  sum += sampleInput(uv - vec2(0.0, step.y)) * 0.15;
  return sum;
}

vec3 applyWhiteBalance(vec3 color) {
  float warm = clamp(uTemperature, -1.0, 1.0);
  float tint = clamp(uTint, -1.0, 1.0);
  vec3 balance = vec3(
    1.0 + warm * 0.14 - tint * 0.03,
    1.0 + tint * 0.08,
    1.0 - warm * 0.14 - tint * 0.03
  );
  return color * max(balance, vec3(0.0));
}

float subjectMask(vec2 uv, vec4 box) {
  vec2 boxMin = box.xy;
  vec2 boxMax = box.xy + box.zw;
  float edgeSoftness = 0.045;

  float left = smoothstep(boxMin.x, boxMin.x + edgeSoftness, uv.x);
  float right = 1.0 - smoothstep(boxMax.x - edgeSoftness, boxMax.x, uv.x);
  float top = smoothstep(boxMin.y, boxMin.y + edgeSoftness, uv.y);
  float bottom = 1.0 - smoothstep(boxMax.y - edgeSoftness, boxMax.y, uv.y);
  return clamp(left * right * top * bottom, 0.0, 1.0);
}

void main() {
  float shutterNorm = clamp(
    (log(uShutter) - log(1.0 / 8000.0)) / (log(1.0 / 15.0) - log(1.0 / 8000.0)),
    0.0,
    1.0
  );
  float apertureNorm = clamp((uAperture - 1.4) / (22.0 - 1.4), 0.0, 1.0);
  float apertureWide = 1.0 - apertureNorm;
  float focusNorm = clamp((uFocusDistance - 0.2) / (50.0 - 0.2), 0.0, 1.0);
  vec2 lensCenter = clamp(vec2(0.5) + uLensShift, vec2(0.02), vec2(0.98));
  float subjectStrength = clamp(uSubjectStrength, 0.0, 1.0);
  float subjectBlend = subjectStrength * 0.62;
  vec2 subjectCenter = mix(lensCenter, clamp(uSubjectCenter, 0.0, 1.0), subjectBlend);
  vec2 subjectBoxMin = clamp(uSubjectBox.xy, vec2(0.0), vec2(0.98));
  vec2 subjectBoxSize = clamp(uSubjectBox.zw, vec2(0.02), vec2(1.0));
  vec4 safeSubjectBox = vec4(
    subjectBoxMin,
    min(subjectBoxSize, vec2(1.0) - subjectBoxMin)
  );

  float focusPlane = focusNorm;
  float sceneDepth = clamp(length(vUv - subjectCenter) * 1.8, 0.0, 1.0);
  float coc = abs(sceneDepth - focusPlane);
  float protectedSubject = subjectMask(vUv, safeSubjectBox) * subjectBlend;
  coc = mix(coc, coc * 0.35, protectedSubject);
  float focusBlurStrength = mix(1.2, 9.0, apertureWide);
  float blurPixels = shutterNorm * 5.0 + coc * focusBlurStrength;
  float upscaleMag = max(1.0, max(uEffectScale.x, uEffectScale.y));
  float styleBoost = mix(1.0, pow(upscaleMag, 0.45), uUpscaleStyle);

  vec2 blurStepX = vec2((blurPixels * uEffectScale.x * styleBoost) / uResolution.x, 0.0);
  vec2 blurStepY = vec2(0.0, (blurPixels * uEffectScale.y * styleBoost) / uResolution.y);

  vec3 color = sampleInput(vUv) * 0.24;
  color += sampleInput(vUv - blurStepX * 2.0) * 0.10;
  color += sampleInput(vUv - blurStepX) * 0.15;
  color += sampleInput(vUv + blurStepX) * 0.15;
  color += sampleInput(vUv + blurStepX * 2.0) * 0.10;
  color += sampleInput(vUv - blurStepY) * 0.13;
  color += sampleInput(vUv + blurStepY) * 0.13;

  float isoNorm = clamp((uIso - 100.0) / (6400.0 - 100.0), 0.0, 1.0);
  float grain = hash12(gl_FragCoord.xy + vec2(uFrame * 0.173, uFrame * 0.319)) - 0.5;
  float grainScale = mix(1.0, pow(upscaleMag, 0.33), uUpscaleStyle);
  float grainAmount = (isoNorm * 0.07) * (1.0 - uNoiseReduction * 0.45);
  color += grain * grainAmount * (0.35 + color) * grainScale;

  vec2 pixelStep = vec2(
    (uEffectScale.x * styleBoost) / uResolution.x,
    (uEffectScale.y * styleBoost) / uResolution.y
  );
  vec3 denoised = crossBlur(vUv, pixelStep * (0.8 + isoNorm));
  float nrAmount = clamp(uNoiseReduction * (0.35 + isoNorm * 0.85), 0.0, 0.95);
  float enhancedNr = clamp(nrAmount * (1.2 + isoNorm * 0.2), 0.0, 0.98);
  nrAmount = mix(nrAmount, enhancedNr, uUpscaleStyle);
  color = mix(color, denoised, nrAmount);

  vec3 localAverage = crossBlur(vUv, pixelStep * 0.85);
  vec3 detail = color - localAverage;
  float detailGain = uSharpen * 1.35;
  detailGain = mix(detailGain, detailGain + (styleBoost - 1.0) * 0.24, uUpscaleStyle);
  color += detail * detailGain;
  color = applyWhiteBalance(color);

  if (uToneMapEnabled > 0.5) {
    color = filmic(color);
    color *= 0.92;
  }

  color = (color - 0.5) * uContrast + 0.5;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uSaturation);

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
  }

  outColor = vec4(finalColor, 1.0);
}
`;

export class WebGLImageRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly positionBuffer: WebGLBuffer;
  private readonly uvBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
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
  private readonly lensShiftUniform: WebGLUniformLocation;
  private readonly lensSubjectCenterUniform: WebGLUniformLocation;
  private readonly lensSubjectStrengthUniform: WebGLUniformLocation;

  private readonly effectsInputUniform: WebGLUniformLocation;
  private readonly effectsResolutionUniform: WebGLUniformLocation;
  private readonly effectsScaleUniform: WebGLUniformLocation;
  private readonly effectsUpscaleStyleUniform: WebGLUniformLocation;
  private readonly effectsShutterUniform: WebGLUniformLocation;
  private readonly effectsIsoUniform: WebGLUniformLocation;
  private readonly effectsApertureUniform: WebGLUniformLocation;
  private readonly effectsFocusDistanceUniform: WebGLUniformLocation;
  private readonly effectsLensShiftUniform: WebGLUniformLocation;
  private readonly effectsTemperatureUniform: WebGLUniformLocation;
  private readonly effectsTintUniform: WebGLUniformLocation;
  private readonly effectsContrastUniform: WebGLUniformLocation;
  private readonly effectsSaturationUniform: WebGLUniformLocation;
  private readonly effectsSharpenUniform: WebGLUniformLocation;
  private readonly effectsNoiseReductionUniform: WebGLUniformLocation;
  private readonly effectsToneMapUniform: WebGLUniformLocation;
  private readonly effectsFrameUniform: WebGLUniformLocation;
  private readonly effectsSubjectCenterUniform: WebGLUniformLocation;
  private readonly effectsSubjectBoxUniform: WebGLUniformLocation;
  private readonly effectsSubjectStrengthUniform: WebGLUniformLocation;

  private readonly compositeOriginalUniform: WebGLUniformLocation;
  private readonly compositeProcessedUniform: WebGLUniformLocation;
  private readonly compositeImageSizeUniform: WebGLUniformLocation;
  private readonly compositeCanvasSizeUniform: WebGLUniformLocation;
  private readonly compositePreviewModeUniform: WebGLUniformLocation;
  private readonly compositeSplitPositionUniform: WebGLUniformLocation;
  private readonly histogramFramebuffer: WebGLFramebuffer;
  private readonly histogramTexture: WebGLTexture;
  private readonly histogramPixels = new Uint8Array(HISTOGRAM_SIZE * HISTOGRAM_SIZE * 4);
  private readonly histogram: HistogramData = {
    r: new Float32Array(HISTOGRAM_BINS),
    g: new Float32Array(HISTOGRAM_BINS),
    b: new Float32Array(HISTOGRAM_BINS),
    maxBin: 0,
    version: 0
  };

  private sourceWidth = 1;
  private sourceHeight = 1;
  private processWidth = 1;
  private processHeight = 1;
  private readonly maxProcessDimension: number;
  private readonly maxProcessPixels: number;
  private frameIndex = 0;
  private params: CameraParams = { ...DEFAULT_CAMERA_PARAMS };
  private subjectContext: RendererSubjectContext = { ...DEFAULT_SUBJECT_CONTEXT };
  private lastHistogramUpdateMs = -Infinity;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true
    });
    if (!gl) {
      throw new Error("WebGL2 is unavailable in this browser.");
    }
    this.gl = gl;
    const maxTextureSize = Number(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) ?? 4096);
    this.maxProcessDimension = Math.max(2048, Math.min(maxTextureSize, 8192));
    this.maxProcessPixels = DEFAULT_MAX_PROCESS_PIXELS;

    const quad = this.createFullscreenQuad();
    this.vao = quad.vao;
    this.positionBuffer = quad.positionBuffer;
    this.uvBuffer = quad.uvBuffer;
    this.indexBuffer = quad.indexBuffer;
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
    this.lensShiftUniform = this.requireUniform(this.lensProgram, "uLensShift");
    this.lensSubjectCenterUniform = this.requireUniform(this.lensProgram, "uSubjectCenter");
    this.lensSubjectStrengthUniform = this.requireUniform(this.lensProgram, "uSubjectStrength");

    this.effectsInputUniform = this.requireUniform(this.effectsProgram, "uInput");
    this.effectsResolutionUniform = this.requireUniform(this.effectsProgram, "uResolution");
    this.effectsScaleUniform = this.requireUniform(this.effectsProgram, "uEffectScale");
    this.effectsUpscaleStyleUniform = this.requireUniform(this.effectsProgram, "uUpscaleStyle");
    this.effectsShutterUniform = this.requireUniform(this.effectsProgram, "uShutter");
    this.effectsIsoUniform = this.requireUniform(this.effectsProgram, "uIso");
    this.effectsApertureUniform = this.requireUniform(this.effectsProgram, "uAperture");
    this.effectsFocusDistanceUniform = this.requireUniform(this.effectsProgram, "uFocusDistance");
    this.effectsLensShiftUniform = this.requireUniform(this.effectsProgram, "uLensShift");
    this.effectsTemperatureUniform = this.requireUniform(this.effectsProgram, "uTemperature");
    this.effectsTintUniform = this.requireUniform(this.effectsProgram, "uTint");
    this.effectsContrastUniform = this.requireUniform(this.effectsProgram, "uContrast");
    this.effectsSaturationUniform = this.requireUniform(this.effectsProgram, "uSaturation");
    this.effectsSharpenUniform = this.requireUniform(this.effectsProgram, "uSharpen");
    this.effectsNoiseReductionUniform = this.requireUniform(this.effectsProgram, "uNoiseReduction");
    this.effectsToneMapUniform = this.requireUniform(this.effectsProgram, "uToneMapEnabled");
    this.effectsFrameUniform = this.requireUniform(this.effectsProgram, "uFrame");
    this.effectsSubjectCenterUniform = this.requireUniform(this.effectsProgram, "uSubjectCenter");
    this.effectsSubjectBoxUniform = this.requireUniform(this.effectsProgram, "uSubjectBox");
    this.effectsSubjectStrengthUniform = this.requireUniform(this.effectsProgram, "uSubjectStrength");

    this.compositeOriginalUniform = this.requireUniform(this.compositeProgram, "uOriginal");
    this.compositeProcessedUniform = this.requireUniform(this.compositeProgram, "uProcessed");
    this.compositeImageSizeUniform = this.requireUniform(this.compositeProgram, "uImageSize");
    this.compositeCanvasSizeUniform = this.requireUniform(this.compositeProgram, "uCanvasSize");
    this.compositePreviewModeUniform = this.requireUniform(this.compositeProgram, "uPreviewMode");
    this.compositeSplitPositionUniform = this.requireUniform(this.compositeProgram, "uSplitPosition");

    const histogramFramebuffer = this.gl.createFramebuffer();
    const histogramTexture = this.createTexture();
    if (!histogramFramebuffer) {
      throw new Error("Failed to create histogram framebuffer.");
    }

    this.histogramFramebuffer = histogramFramebuffer;
    this.histogramTexture = histogramTexture;
    this.allocateHistogramResources();
    this.initializeSourceTexture();
  }

  setParams(params: Readonly<CameraParams>): void {
    this.params = { ...params };
    this.updateProcessSize();
  }

  setSubjectContext(context: RendererSubjectContext | null): void {
    if (!context) {
      this.subjectContext = { ...DEFAULT_SUBJECT_CONTEXT };
      return;
    }

    const center = {
      x: clampNumber(context.center.x, 0, 1),
      y: clampNumber(context.center.y, 0, 1)
    };
    const box = {
      x: clampNumber(context.box.x, 0, 1),
      y: clampNumber(context.box.y, 0, 1),
      width: clampNumber(context.box.width, 0.02, 1),
      height: clampNumber(context.box.height, 0.02, 1)
    };
    box.width = Math.min(box.width, 1 - box.x);
    box.height = Math.min(box.height, 1 - box.y);

    this.subjectContext = {
      center,
      box,
      strength: clampNumber(context.strength, 0, 1)
    };
  }

  getHistogram(): HistogramData {
    return this.histogram;
  }

  getEffectiveProcessScale(): { x: number; y: number } {
    return {
      x: this.processWidth / this.sourceWidth,
      y: this.processHeight / this.sourceHeight
    };
  }

  captureSnapshotCanvas(upscaleFactor: UpscaleFactor): HTMLCanvasElement | null {
    this.runInputPass();
    this.runLensPass();
    this.runEffectsPass();

    const target = this.computeSnapshotSize(upscaleFactor);
    const framebuffer = this.gl.createFramebuffer();
    const texture = this.createTexture();
    if (!framebuffer || !texture) {
      return null;
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      target.width,
      target.height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null
    );

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      texture,
      0
    );

    this.gl.viewport(0, 0, target.width, target.height);
    this.drawComposite(target.width, target.height, target.width, target.height);

    const pixels = new Uint8Array(target.width * target.height * 4);
    this.gl.readPixels(
      0,
      0,
      target.width,
      target.height,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      pixels
    );

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.deleteFramebuffer(framebuffer);
    this.gl.deleteTexture(texture);

    return pixelsToCanvas(pixels, target.width, target.height);
  }

  dispose(): void {
    this.pingPong.dispose();
    this.gl.deleteTexture(this.sourceTexture);
    this.gl.deleteTexture(this.histogramTexture);
    this.gl.deleteFramebuffer(this.histogramFramebuffer);
    this.gl.deleteBuffer(this.positionBuffer);
    this.gl.deleteBuffer(this.uvBuffer);
    this.gl.deleteBuffer(this.indexBuffer);
    this.gl.deleteVertexArray(this.vao);

    this.gl.deleteProgram(this.inputProgram);
    this.gl.deleteProgram(this.lensProgram);
    this.gl.deleteProgram(this.effectsProgram);
    this.gl.deleteProgram(this.compositeProgram);
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
    this.updateHistogramIfNeeded();
    this.frameIndex += 1;
  }

  private runInputPass(): void {
    const target = this.pingPong.getA();

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
    this.gl.viewport(0, 0, this.processWidth, this.processHeight);
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
    this.gl.viewport(0, 0, this.processWidth, this.processHeight);
    this.gl.useProgram(this.lensProgram);
    this.gl.bindVertexArray(this.vao);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, read.texture);
    this.gl.uniform1i(this.lensInputUniform, 0);
    this.gl.uniform1f(this.lensDistortionUniform, this.params.distortion);
    this.gl.uniform1f(this.lensFocalLengthUniform, this.params.focalLength);
    this.gl.uniform1f(this.lensChromaUniform, this.params.chromaAberration);
    this.gl.uniform1f(this.lensVignetteUniform, this.params.vignette);
    this.gl.uniform2f(this.lensShiftUniform, this.params.lensShiftX, this.params.lensShiftY);
    this.gl.uniform2f(
      this.lensSubjectCenterUniform,
      this.subjectContext.center.x,
      this.subjectContext.center.y
    );
    this.gl.uniform1f(this.lensSubjectStrengthUniform, this.subjectContext.strength);

    this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.bindVertexArray(null);
    this.gl.useProgram(null);
  }

  private runEffectsPass(): void {
    const read = this.pingPong.getB();
    const write = this.pingPong.getA();

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, write.framebuffer);
    this.gl.viewport(0, 0, this.processWidth, this.processHeight);
    this.gl.useProgram(this.effectsProgram);
    this.gl.bindVertexArray(this.vao);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, read.texture);
    this.gl.uniform1i(this.effectsInputUniform, 0);
    this.gl.uniform2f(this.effectsResolutionUniform, this.processWidth, this.processHeight);
    this.gl.uniform2f(
      this.effectsScaleUniform,
      this.processWidth / this.sourceWidth,
      this.processHeight / this.sourceHeight
    );
    this.gl.uniform1f(
      this.effectsUpscaleStyleUniform,
      this.params.upscaleStyle === "enhanced" ? 1 : 0
    );
    this.gl.uniform1f(this.effectsShutterUniform, this.params.shutter);
    this.gl.uniform1f(this.effectsIsoUniform, this.params.iso);
    this.gl.uniform1f(this.effectsApertureUniform, this.params.aperture);
    this.gl.uniform1f(this.effectsFocusDistanceUniform, this.params.focusDistance);
    this.gl.uniform2f(this.effectsLensShiftUniform, this.params.lensShiftX, this.params.lensShiftY);
    this.gl.uniform1f(this.effectsTemperatureUniform, this.params.temperature);
    this.gl.uniform1f(this.effectsTintUniform, this.params.tint);
    this.gl.uniform1f(this.effectsContrastUniform, this.params.contrast);
    this.gl.uniform1f(this.effectsSaturationUniform, this.params.saturation);
    this.gl.uniform1f(this.effectsSharpenUniform, this.params.sharpen);
    this.gl.uniform1f(this.effectsNoiseReductionUniform, this.params.noiseReduction);
    this.gl.uniform1f(this.effectsToneMapUniform, this.params.toneMap ? 1 : 0);
    this.gl.uniform1f(this.effectsFrameUniform, this.frameIndex);
    this.gl.uniform2f(
      this.effectsSubjectCenterUniform,
      this.subjectContext.center.x,
      this.subjectContext.center.y
    );
    this.gl.uniform4f(
      this.effectsSubjectBoxUniform,
      this.subjectContext.box.x,
      this.subjectContext.box.y,
      this.subjectContext.box.width,
      this.subjectContext.box.height
    );
    this.gl.uniform1f(this.effectsSubjectStrengthUniform, this.subjectContext.strength);

    this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.bindVertexArray(null);
    this.gl.useProgram(null);
  }

  private runCompositePass(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clearColor(0.08, 0.09, 0.11, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.drawComposite(this.canvas.width, this.canvas.height, this.canvas.width, this.canvas.height);
  }

  private updateHistogramIfNeeded(): void {
    const now = performance.now();
    if (now - this.lastHistogramUpdateMs < HISTOGRAM_INTERVAL_MS) {
      return;
    }
    this.lastHistogramUpdateMs = now;

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.histogramFramebuffer);
    this.gl.viewport(0, 0, HISTOGRAM_SIZE, HISTOGRAM_SIZE);
    this.drawComposite(
      HISTOGRAM_SIZE,
      HISTOGRAM_SIZE,
      this.canvas.width,
      this.canvas.height,
      this.histogramPreviewMode()
    );
    this.gl.readPixels(
      0,
      0,
      HISTOGRAM_SIZE,
      HISTOGRAM_SIZE,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      this.histogramPixels
    );

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

    this.buildHistogramBins();
  }

  private drawComposite(
    viewportWidth: number,
    viewportHeight: number,
    canvasWidthForUniform: number,
    canvasHeightForUniform: number,
    previewModeOverride?: PreviewMode
  ): void {
    const processed = this.pingPong.getA();

    this.gl.useProgram(this.compositeProgram);
    this.gl.bindVertexArray(this.vao);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.uniform1i(this.compositeOriginalUniform, 0);

    this.gl.activeTexture(this.gl.TEXTURE1);
    this.gl.bindTexture(this.gl.TEXTURE_2D, processed.texture);
    this.gl.uniform1i(this.compositeProcessedUniform, 1);

    this.gl.uniform2f(this.compositeImageSizeUniform, this.sourceWidth, this.sourceHeight);
    this.gl.uniform2f(this.compositeCanvasSizeUniform, canvasWidthForUniform, canvasHeightForUniform);
    this.gl.uniform1f(
      this.compositePreviewModeUniform,
      this.previewModeToUniform(previewModeOverride ?? this.params.previewMode)
    );
    this.gl.uniform1f(this.compositeSplitPositionUniform, this.params.splitPosition);

    this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.bindVertexArray(null);
    this.gl.useProgram(null);
    this.gl.viewport(0, 0, viewportWidth, viewportHeight);
  }

  private histogramPreviewMode(): PreviewMode {
    if (this.params.histogramMode === "original") {
      return "original";
    }
    if (this.params.histogramMode === "processed") {
      return "processed";
    }
    return this.params.previewMode;
  }

  private buildHistogramBins(): void {
    this.histogram.r.fill(0);
    this.histogram.g.fill(0);
    this.histogram.b.fill(0);

    const binsMinusOne = HISTOGRAM_BINS - 1;
    const pixels = this.histogramPixels;

    for (let i = 0; i < pixels.length; i += 4) {
      const rBin = Math.min(binsMinusOne, (pixels[i] * HISTOGRAM_BINS) >> 8);
      const gBin = Math.min(binsMinusOne, (pixels[i + 1] * HISTOGRAM_BINS) >> 8);
      const bBin = Math.min(binsMinusOne, (pixels[i + 2] * HISTOGRAM_BINS) >> 8);
      this.histogram.r[rBin] += 1;
      this.histogram.g[gBin] += 1;
      this.histogram.b[bBin] += 1;
    }

    let maxBin = 1;
    for (let i = 0; i < HISTOGRAM_BINS; i += 1) {
      maxBin = Math.max(maxBin, this.histogram.r[i], this.histogram.g[i], this.histogram.b[i]);
    }

    this.histogram.maxBin = maxBin;
    this.histogram.version += 1;
  }

  private allocateHistogramResources(): void {
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.histogramTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      HISTOGRAM_SIZE,
      HISTOGRAM_SIZE,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null
    );

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.histogramFramebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      this.histogramTexture,
      0
    );

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
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

    this.updateProcessSize();
  }

  private updateProcessSize(): void {
    const upscale = this.coerceUpscaleFactor(this.params.upscaleFactor);
    const previewScale = clampNumber(this.params.previewScale, 0.5, 1);
    let nextWidth = Math.max(1, Math.floor(this.sourceWidth * upscale * previewScale));
    let nextHeight = Math.max(1, Math.floor(this.sourceHeight * upscale * previewScale));

    const maxDim = Math.max(nextWidth, nextHeight);
    if (maxDim > this.maxProcessDimension) {
      const downscale = this.maxProcessDimension / maxDim;
      nextWidth = Math.max(1, Math.floor(nextWidth * downscale));
      nextHeight = Math.max(1, Math.floor(nextHeight * downscale));
    }

    const pixelCount = nextWidth * nextHeight;
    if (pixelCount > this.maxProcessPixels) {
      const downscale = Math.sqrt(this.maxProcessPixels / pixelCount);
      nextWidth = Math.max(1, Math.floor(nextWidth * downscale));
      nextHeight = Math.max(1, Math.floor(nextHeight * downscale));
    }

    if (nextWidth === this.processWidth && nextHeight === this.processHeight) {
      return;
    }

    this.processWidth = nextWidth;
    this.processHeight = nextHeight;
    this.pingPong.resize(nextWidth, nextHeight);
  }

  private computeSnapshotSize(upscaleFactor: UpscaleFactor): { width: number; height: number } {
    let width = Math.max(1, Math.floor(this.sourceWidth * upscaleFactor));
    let height = Math.max(1, Math.floor(this.sourceHeight * upscaleFactor));

    const maxDim = Math.max(width, height);
    if (maxDim > this.maxProcessDimension) {
      const scale = this.maxProcessDimension / maxDim;
      width = Math.max(1, Math.floor(width * scale));
      height = Math.max(1, Math.floor(height * scale));
    }

    const pixelCount = width * height;
    if (pixelCount > this.maxProcessPixels) {
      const scale = Math.sqrt(this.maxProcessPixels / pixelCount);
      width = Math.max(1, Math.floor(width * scale));
      height = Math.max(1, Math.floor(height * scale));
    }

    return { width, height };
  }

  private coerceUpscaleFactor(value: number): UpscaleFactor {
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

  private createFullscreenQuad(): {
    vao: WebGLVertexArrayObject;
    positionBuffer: WebGLBuffer;
    uvBuffer: WebGLBuffer;
    indexBuffer: WebGLBuffer;
  } {
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

    return {
      vao,
      positionBuffer,
      uvBuffer,
      indexBuffer
    };
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pixelsToCanvas(pixels: Uint8Array, width: number, height: number): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const flipped = new Uint8ClampedArray(pixels.length);
  const rowSize = width * 4;
  for (let y = 0; y < height; y += 1) {
    const src = y * rowSize;
    const dst = (height - 1 - y) * rowSize;
    flipped.set(pixels.subarray(src, src + rowSize), dst);
  }

  ctx.putImageData(new ImageData(flipped, width, height), 0, 0);
  return canvas;
}
