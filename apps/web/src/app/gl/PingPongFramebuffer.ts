export type FramebufferTarget = {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
};

export class PingPongFramebuffer {
  private readonly gl: WebGL2RenderingContext;
  private readonly targetA: FramebufferTarget;
  private readonly targetB: FramebufferTarget;
  private width = 0;
  private height = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.targetA = this.createTarget();
    this.targetB = this.createTarget();
  }

  resize(width: number, height: number): void {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    if (safeWidth === this.width && safeHeight === this.height) {
      return;
    }

    this.width = safeWidth;
    this.height = safeHeight;

    this.allocateTarget(this.targetA, safeWidth, safeHeight);
    this.allocateTarget(this.targetB, safeWidth, safeHeight);
  }

  getA(): FramebufferTarget {
    return this.targetA;
  }

  getB(): FramebufferTarget {
    return this.targetB;
  }

  private createTarget(): FramebufferTarget {
    const texture = this.gl.createTexture();
    const framebuffer = this.gl.createFramebuffer();
    if (!texture || !framebuffer) {
      throw new Error("Failed to create ping-pong framebuffer resources.");
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      texture,
      0
    );

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);

    return {
      framebuffer,
      texture
    };
  }

  private allocateTarget(target: FramebufferTarget, width: number, height: number): void {
    this.gl.bindTexture(this.gl.TEXTURE_2D, target.texture);
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
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }
}

