import { hash, mesh } from './math';
import * as shaders from './shaders';
import { view, perspective, orthographic, multiply } from './matrix';
type Target = {
  framebuffer: WebGLFramebuffer;
  textures: WebGLTexture[];
  width: number;
  height: number;
};
type Geometry = { vao: WebGLVertexArrayObject; count: number };
export class GraphicsLoad {
  private gl: WebGL2RenderingContext;
  private programs: WebGLProgram[] = [];
  private buffers: WebGLBuffer[] = [];
  private vaos: WebGLVertexArrayObject[] = [];
  private targets: Target[] = [];
  private depths: WebGLRenderbuffer[] = [];
  private locations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private torus!: Geometry;
  private cube!: Geometry;
  private empty!: WebGLVertexArrayObject;
  private scene!: Target;
  private shadow!: Target;
  private ao!: Target;
  private hdr!: Target;
  private glow!: Target;
  private probe!: Target;
  private ldr!: Target;
  private instances: number;
  readonly renderer: string;
  readonly triangles: number;
  constructor(
    private canvas: HTMLCanvasElement,
    heavy = true,
    private effects = { ssao: true, bloom: true, shadows: true },
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 2 is unavailable.');
    this.gl = gl;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    this.instances = heavy ? 96 : 8;
    const data = mesh(heavy ? 256 : 32, heavy ? 48 : 8);
    this.triangles = (data.indices.length / 3) * this.instances + 36 * 12;
    try {
      if (!gl.getExtension('EXT_color_buffer_float'))
        throw new Error('Floating-point render targets required for HDR / SSAO are unavailable.');
      this.programs.push(
        this.program(shaders.geometry, shaders.gbuffer),
        this.program(shaders.geometry, shaders.depth),
        this.program(shaders.fullscreen, shaders.ao),
        this.program(shaders.fullscreen, shaders.lighting),
        this.program(shaders.fullscreen, shaders.bloom),
        this.program(shaders.fullscreen, shaders.composite),
        this.program(shaders.fullscreen, shaders.probe),
        this.program(shaders.fullscreen, shaders.antialias),
      );
      this.torus = this.geometry(data.vertices, data.indices);
      this.cube = this.geometry(
        new Float32Array(
          [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1].map(
            (v) => v * 0.5,
          ),
        ),
        new Uint32Array([
          0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3,
          1, 2, 6, 1, 6, 5,
        ]),
      );
      this.empty = gl.createVertexArray()!;
      this.vaos.push(this.empty);
      const w = canvas.width,
        h = canvas.height;
      this.scene = this.target(w, h, [gl.RGBA16F, gl.RGBA16F, gl.RGBA8], true);
      this.shadow = this.target(heavy ? 2048 : 512, heavy ? 2048 : 512, [gl.DEPTH_COMPONENT24]);
      this.ao = this.target(Math.ceil(w / 2), Math.ceil(h / 2), [gl.RGBA8]);
      this.hdr = this.target(w, h, [gl.RGBA16F]);
      this.glow = this.target(Math.ceil(w / 2), Math.ceil(h / 2), [gl.RGBA16F]);
      this.probe = this.target(16, 16, [gl.RGBA8UI]);
      this.ldr = this.target(w, h, [gl.RGBA8]);
      gl.bindTexture(gl.TEXTURE_2D, this.ldr.textures[0]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.disable(gl.DITHER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('GPU setup failed.');
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  private geometry(vertices: Float32Array, indices: Uint32Array): Geometry {
    const gl = this.gl,
      vao = gl.createVertexArray()!;
    this.vaos.push(vao);
    gl.bindVertexArray(vao);
    for (const [target, bytes] of [
      [gl.ARRAY_BUFFER, vertices],
      [gl.ELEMENT_ARRAY_BUFFER, indices],
    ] as const) {
      const b = gl.createBuffer()!;
      this.buffers.push(b);
      gl.bindBuffer(target, b);
      gl.bufferData(target, bytes, gl.STATIC_DRAW);
    }
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    return { vao, count: indices.length };
  }
  private target(width: number, height: number, formats: number[], depth = false): Target {
    const gl = this.gl,
      result: Target = { framebuffer: gl.createFramebuffer()!, textures: [], width, height };
    this.targets.push(result);
    gl.bindFramebuffer(gl.FRAMEBUFFER, result.framebuffer);
    formats.forEach((format, i) => {
      const texture = gl.createTexture()!;
      result.textures.push(texture);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        format === gl.DEPTH_COMPONENT24 ? gl.DEPTH_ATTACHMENT : gl.COLOR_ATTACHMENT0 + i,
        gl.TEXTURE_2D,
        texture,
        0,
      );
    });
    if (formats[0] === gl.DEPTH_COMPONENT24) {
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
    } else gl.drawBuffers(formats.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    if (depth) {
      const buffer = gl.createRenderbuffer()!;
      this.depths.push(buffer);
      gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, buffer);
    }
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('GPU render target is unavailable.');
    return result;
  }
  private program(vs: string, fs: string) {
    const gl = this.gl,
      p = gl.createProgram()!,
      compiled: WebGLShader[] = [];
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vs],
        [gl.FRAGMENT_SHADER, fs],
      ] as const) {
        const s = gl.createShader(type)!;
        compiled.push(s);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(s) || 'Shader compilation failed.');
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(p) || 'Shader link failed.');
      return p;
    } catch (e) {
      gl.deleteProgram(p);
      throw e;
    } finally {
      compiled.forEach((s) => gl.deleteShader(s));
    }
  }
  private uniform(p: WebGLProgram, name: string) {
    let map = this.locations.get(p);
    if (!map) {
      map = new Map();
      this.locations.set(p, map);
    }
    if (!map.has(name)) map.set(name, this.gl.getUniformLocation(p, name));
    return map.get(name)!;
  }
  private bind(target: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(0, 0, target?.width ?? this.canvas.width, target?.height ?? this.canvas.height);
  }
  private texture(p: WebGLProgram, name: string, texture: WebGLTexture, unit: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.uniform(p, name), unit);
  }
  private objects(p: WebGLProgram, transform: Float32Array, time: number) {
    const gl = this.gl;
    gl.useProgram(p);
    gl.enable(gl.DEPTH_TEST);
    gl.uniform1f(this.uniform(p, 'time'), time);
    gl.uniformMatrix4fv(this.uniform(p, 'transform'), false, transform);
    gl.uniform2f(
      this.uniform(p, 'grid'),
      this.instances === 8 ? 4 : 8,
      this.instances === 8 ? 2 : 6,
    );
    gl.uniform1i(this.uniform(p, 'mode'), 0);
    gl.bindVertexArray(this.torus.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.torus.count, gl.UNSIGNED_INT, 0, this.instances);
    gl.uniform1i(this.uniform(p, 'mode'), 1);
    gl.bindVertexArray(this.cube.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.cube.count, gl.UNSIGNED_INT, 0, 36);
  }
  private pass(p: WebGLProgram) {
    this.gl.disable(this.gl.DEPTH_TEST);
    this.gl.useProgram(p);
    this.gl.bindVertexArray(this.empty);
  }
  render(time: number) {
    const gl = this.gl;
    if (gl.isContextLost()) throw new Error('GPU context lost.');
    const camera = [Math.sin(time * 0.13) * 1.1, Math.sin(time * 0.17) * 0.35, 8.8],
      key = [Math.sin(time * 0.2) * 4, 5, 6];
    const vp = multiply(
        perspective(this.canvas.width / this.canvas.height),
        view(camera, [0, 0, -1]),
      ),
      light = multiply(orthographic, view(key, [0, 0, -2]));
    // Avoid feedback between previous-frame samplers and the current render attachments.
    for (let unit = 0; unit < 5; unit++) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    if (this.effects.shadows) {
      this.bind(this.shadow);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this.objects(this.programs[1], light, time);
    }
    this.bind(this.scene);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.objects(this.programs[0], vp, time);
    let p = this.programs[2];
    this.bind(this.ao);
    this.pass(p);
    this.texture(p, 'positions', this.scene.textures[0], 0);
    this.texture(p, 'normals', this.scene.textures[1], 1);
    gl.uniformMatrix4fv(this.uniform(p, 'viewProjection'), false, vp);
    gl.uniform3fv(this.uniform(p, 'camera'), camera);
    gl.uniform1i(this.uniform(p, 'enabled'), +this.effects.ssao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    p = this.programs[3];
    this.bind(this.hdr);
    this.pass(p);
    this.texture(p, 'positions', this.scene.textures[0], 0);
    this.texture(p, 'normals', this.scene.textures[1], 1);
    this.texture(p, 'albedos', this.scene.textures[2], 2);
    this.texture(p, 'ambient', this.ao.textures[0], 3);
    this.texture(p, 'shadow', this.shadow.textures[0], 4);
    gl.uniformMatrix4fv(this.uniform(p, 'lightTransform'), false, light);
    gl.uniform3fv(this.uniform(p, 'camera'), camera);
    gl.uniform3fv(this.uniform(p, 'keyLight'), key);
    gl.uniform1f(this.uniform(p, 'time'), time);
    gl.uniform1i(this.uniform(p, 'shadows'), +this.effects.shadows);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.effects.bloom) {
      p = this.programs[4];
      this.bind(this.glow);
      this.pass(p);
      this.texture(p, 'source', this.hdr.textures[0], 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    p = this.programs[5];
    this.bind(this.ldr);
    this.pass(p);
    this.texture(p, 'source', this.hdr.textures[0], 0);
    this.texture(p, 'glow', this.glow.textures[0], 1);
    gl.uniform1i(this.uniform(p, 'enabled'), +this.effects.bloom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    p = this.programs[7];
    this.bind(null);
    this.pass(p);
    this.texture(p, 'source', this.ldr.textures[0], 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('GPU rendering error.');
  }
  verify(seed: number) {
    const gl = this.gl,
      p = this.programs[6],
      pixels = new Uint8Array(16 * 16 * 4);
    this.bind(this.probe);
    this.pass(p);
    gl.uniform1ui(this.uniform(p, 'seed'), seed >>> 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 16, 16, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, pixels);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('GPU readback error.');
    for (let i = 0; i < 256; i++) {
      const expected = hash(i ^ seed);
      for (let b = 0; b < 4; b++)
        if (pixels[i * 4 + b] !== ((expected >>> (8 * b)) & 255))
          throw new Error('GPU verification mismatch.');
    }
    this.bind(null);
  }
  dispose() {
    const gl = this.gl;
    this.buffers.forEach((b) => gl.deleteBuffer(b));
    this.programs.forEach((p) => gl.deleteProgram(p));
    this.vaos.forEach((v) => gl.deleteVertexArray(v));
    this.depths.forEach((d) => gl.deleteRenderbuffer(d));
    this.targets.forEach((t) => {
      t.textures.forEach((x) => gl.deleteTexture(x));
      gl.deleteFramebuffer(t.framebuffer);
    });
  }
}
