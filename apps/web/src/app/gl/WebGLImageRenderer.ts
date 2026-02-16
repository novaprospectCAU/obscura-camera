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

out vec4 outColor;

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

  if (containedUv.x < 0.0 || containedUv.x > 1.0 || containedUv.y < 0.0 || containedUv.y > 1.0) {
    outColor = vec4(0.08, 0.09, 0.11, 1.0);
    return;
  }

  outColor = texture(uTexture, containedUv);
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
  private imageWidth = 1;
  private imageHeight = 1;

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
    this.gl.clearColor(0.08, 0.09, 0.11, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);

    this.gl.uniform1i(this.uniformTexture, 0);
    this.gl.uniform2f(this.uniformImageSize, this.imageWidth, this.imageHeight);
    this.gl.uniform2f(this.uniformCanvasSize, this.canvas.width, this.canvas.height);

    this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

    this.gl.bindVertexArray(null);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.useProgram(null);
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

    const positions = new Float32Array([
      -1, -1,
      1, -1,
      1, 1,
      -1, 1
    ]);
    const uvs = new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1
    ]);
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
