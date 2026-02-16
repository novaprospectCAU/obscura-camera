import { DEFAULT_CAMERA_PARAMS, type CameraParams, type PreviewMode } from "../state";

const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aUv;

out vec2 vUv;

void main() {
  vUv = aUv;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uTexture;
uniform vec2 uImageSize;
uniform vec2 uCanvasSize;
uniform float uExposureEV;
uniform float uShutter;
uniform float uIso;
uniform float uAperture;
uniform float uFocalLength;
uniform float uFocusDistance;
uniform float uDistortion;
uniform float uVignette;
uniform float uChromaAberration;
uniform float uToneMapEnabled;
uniform float uPreviewMode;
uniform float uSplitPosition;
uniform float uFrame;

out vec4 outColor;

const vec3 BG_COLOR = vec3(0.08, 0.09, 0.11);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 toLinear(vec3 color) {
  return pow(max(color, vec3(0.0)), vec3(2.2));
}

vec3 toSrgb(vec3 color) {
  return pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
}

vec3 filmic(vec3 color) {
  vec3 x = max(vec3(0.0), color - 0.004);
  return (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
}

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

vec2 applyLensTransform(vec2 uv) {
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

  float r = texture(uTexture, clamp(uv + caOffset, 0.0, 1.0)).r;
  float g = texture(uTexture, uv).g;
  float b = texture(uTexture, clamp(uv - caOffset, 0.0, 1.0)).b;
  return vec3(r, g, b);
}

vec3 processColor(vec2 baseUv) {
  vec2 lensUv = applyLensTransform(baseUv);
  if (outsideUv(lensUv)) {
    return BG_COLOR;
  }

  float shutterNorm = clamp(
    (log(uShutter) - log(1.0 / 8000.0)) / (log(1.0 / 15.0) - log(1.0 / 8000.0)),
    0.0,
    1.0
  );
  float apertureNorm = clamp((uAperture - 1.4) / (22.0 - 1.4), 0.0, 1.0);
  float focusNorm = clamp((uFocusDistance - 0.2) / (50.0 - 0.2), 0.0, 1.0);

  float focusPlane = mix(0.12, 0.95, focusNorm);
  float sceneDepth = clamp(length(lensUv - 0.5) * 1.8, 0.0, 1.0);
  float coc = abs(sceneDepth - focusPlane);

  float blurPixels = shutterNorm * 6.0 + coc * apertureNorm * 9.0;
  vec2 blurStepX = vec2(blurPixels / uCanvasSize.x, 0.0);
  vec2 blurStepY = vec2(0.0, blurPixels / uCanvasSize.y);

  vec3 color = sampleWithChroma(lensUv) * 0.24;
  color += sampleWithChroma(lensUv - blurStepX * 2.0) * 0.10;
  color += sampleWithChroma(lensUv - blurStepX) * 0.15;
  color += sampleWithChroma(lensUv + blurStepX) * 0.15;
  color += sampleWithChroma(lensUv + blurStepX * 2.0) * 0.10;
  color += sampleWithChroma(lensUv - blurStepY) * 0.13;
  color += sampleWithChroma(lensUv + blurStepY) * 0.13;

  vec3 linear = toLinear(color);
  linear *= exp2(uExposureEV);

  float radius = length(lensUv - 0.5) * 1.4142;
  float vignetteFactor = 1.0 - (uVignette * smoothstep(0.25, 1.0, radius));
  linear *= vignetteFactor;

  float isoNorm = clamp((uIso - 100.0) / (6400.0 - 100.0), 0.0, 1.0);
  float grain = hash12(gl_FragCoord.xy + vec2(uFrame * 0.173, uFrame * 0.319)) - 0.5;
  linear += grain * (0.03 + isoNorm * 0.09) * (0.35 + linear);

  if (uToneMapEnabled > 0.5) {
    linear = filmic(linear);
  }

  return toSrgb(linear);
}

void main() {
  vec2 containedUv = getContainedUv(vUv);
  if (outsideUv(containedUv)) {
    outColor = vec4(BG_COLOR, 1.0);
    return;
  }

  vec3 originalColor = texture(uTexture, containedUv).rgb;
  vec3 processedColor = processColor(containedUv);
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
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly texture: WebGLTexture;
  private readonly uniformTexture: WebGLUniformLocation;
  private readonly uniformImageSize: WebGLUniformLocation;
  private readonly uniformCanvasSize: WebGLUniformLocation;
  private readonly uniformExposureEV: WebGLUniformLocation;
  private readonly uniformShutter: WebGLUniformLocation;
  private readonly uniformIso: WebGLUniformLocation;
  private readonly uniformAperture: WebGLUniformLocation;
  private readonly uniformFocalLength: WebGLUniformLocation;
  private readonly uniformFocusDistance: WebGLUniformLocation;
  private readonly uniformDistortion: WebGLUniformLocation;
  private readonly uniformVignette: WebGLUniformLocation;
  private readonly uniformChromaAberration: WebGLUniformLocation;
  private readonly uniformToneMapEnabled: WebGLUniformLocation;
  private readonly uniformPreviewMode: WebGLUniformLocation;
  private readonly uniformSplitPosition: WebGLUniformLocation;
  private readonly uniformFrame: WebGLUniformLocation;
  private imageWidth = 1;
  private imageHeight = 1;
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
    this.program = this.createProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    this.vao = this.createFullscreenQuad();
    this.texture = this.createTexture();
    this.uniformTexture = this.requireUniform(this.program, "uTexture");
    this.uniformImageSize = this.requireUniform(this.program, "uImageSize");
    this.uniformCanvasSize = this.requireUniform(this.program, "uCanvasSize");
    this.uniformExposureEV = this.requireUniform(this.program, "uExposureEV");
    this.uniformShutter = this.requireUniform(this.program, "uShutter");
    this.uniformIso = this.requireUniform(this.program, "uIso");
    this.uniformAperture = this.requireUniform(this.program, "uAperture");
    this.uniformFocalLength = this.requireUniform(this.program, "uFocalLength");
    this.uniformFocusDistance = this.requireUniform(this.program, "uFocusDistance");
    this.uniformDistortion = this.requireUniform(this.program, "uDistortion");
    this.uniformVignette = this.requireUniform(this.program, "uVignette");
    this.uniformChromaAberration = this.requireUniform(this.program, "uChromaAberration");
    this.uniformToneMapEnabled = this.requireUniform(this.program, "uToneMapEnabled");
    this.uniformPreviewMode = this.requireUniform(this.program, "uPreviewMode");
    this.uniformSplitPosition = this.requireUniform(this.program, "uSplitPosition");
    this.uniformFrame = this.requireUniform(this.program, "uFrame");
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

    this.gl.viewport(0, 0, width, height);
    this.render();
  }

  setImage(image: HTMLImageElement): void {
    this.imageWidth = image.naturalWidth || 1;
    this.imageHeight = image.naturalHeight || 1;

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
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
    this.imageWidth = width;
    this.imageHeight = height;

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 1);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      width,
      height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null
    );
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
    const needsRealloc = width !== this.imageWidth || height !== this.imageHeight;

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 1);

    if (needsRealloc) {
      this.imageWidth = width;
      this.imageHeight = height;
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        width,
        height,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        null
      );
    }

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
    const params = this.params;

    this.gl.clearColor(0.08, 0.09, 0.11, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);

    this.gl.uniform1i(this.uniformTexture, 0);
    this.gl.uniform2f(this.uniformImageSize, this.imageWidth, this.imageHeight);
    this.gl.uniform2f(this.uniformCanvasSize, this.canvas.width, this.canvas.height);
    this.gl.uniform1f(this.uniformExposureEV, params.exposureEV);
    this.gl.uniform1f(this.uniformShutter, params.shutter);
    this.gl.uniform1f(this.uniformIso, params.iso);
    this.gl.uniform1f(this.uniformAperture, params.aperture);
    this.gl.uniform1f(this.uniformFocalLength, params.focalLength);
    this.gl.uniform1f(this.uniformFocusDistance, params.focusDistance);
    this.gl.uniform1f(this.uniformDistortion, params.distortion);
    this.gl.uniform1f(this.uniformVignette, params.vignette);
    this.gl.uniform1f(this.uniformChromaAberration, params.chromaAberration);
    this.gl.uniform1f(this.uniformToneMapEnabled, params.toneMap ? 1 : 0);
    this.gl.uniform1f(this.uniformPreviewMode, this.previewModeToUniform(params.previewMode));
    this.gl.uniform1f(this.uniformSplitPosition, params.splitPosition);
    this.gl.uniform1f(this.uniformFrame, this.frameIndex);

    this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

    this.gl.bindVertexArray(null);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.useProgram(null);
    this.frameIndex += 1;
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

    const initialPixel = new Uint8Array([20, 23, 28, 255]);
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

