import { hash, mesh } from './math';

const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
uniform float time; uniform float aspect; uniform vec2 grid;
out vec3 world; flat out int instance;
void main() {
  float id=float(gl_InstanceID), a=time*.24+id*.7;
  mat2 rot=mat2(cos(a),-sin(a),sin(a),cos(a));
  vec3 p=position; p.xz=rot*p.xz; p.xy=rot*p.xy;
  float cells=grid.x*grid.y;
  p*=.52; p+=vec3(mod(id,grid.x)-(grid.x-1.)*.5, floor(mod(id,cells)/grid.x)-(grid.y-1.)*.5, -floor(id/cells)*1.8);
  world=p; instance=gl_InstanceID;
  float depth=8.5-p.z;
  gl_Position=vec4(p.x*1.9/aspect,p.y*1.9,(depth-0.2)*0.98,depth);
}`;
const fragment = `#version 300 es
precision highp float;
in vec3 world; flat in int instance; uniform float time;
out vec4 color;
void main() {
  vec3 n=normalize(cross(dFdx(world),dFdy(world)));
  vec3 palette[4]=vec3[4](vec3(.16,.20,.22),vec3(.66,.70,.68),vec3(.57,.71,.61),vec3(.72,.81,.50));
  vec3 base=palette[instance%4]; float waves=0.;
  vec3 q=world;
  for(int i=0;i<12;i++){ q=sin(q.yzx*1.41+float(i)+time*.07); waves+=dot(q,q)*.025; }
  float diffuse=max(dot(n,normalize(vec3(-.4,.8,1.))),0.);
  float spec=pow(max(dot(reflect(normalize(vec3(.4,-.8,-1.)),n),normalize(vec3(0.,0.,8.)-world)),0.),48.);
  float edge=pow(1.-abs(dot(n,normalize(vec3(0.,0.,8.)-world))),3.);
  color=vec4(base*(.16+diffuse*.6+waves*.22)+spec*.65+edge*base*.8,1.);
}`;
const probeVertex = `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.); }`;
const probeFragment = `#version 300 es
precision highp float; precision highp int;
layout(location=0) out uvec4 color; uniform uint seed;
uint hash(uint x){ x=(x^(x>>16u))*0x7feb352du; x=(x^(x>>15u))*0x846ca68bu; return x^(x>>16u); }
void main(){ uint i=uint(gl_FragCoord.y)*16u+uint(gl_FragCoord.x);uint h=hash(i^seed);color=uvec4(h&255u,(h>>8u)&255u,(h>>16u)&255u,(h>>24u)&255u); }`;

export class GraphicsLoad {
  private gl: WebGL2RenderingContext;
  private programs: WebGLProgram[] = [];
  private buffers: WebGLBuffer[] = [];
  private vao: WebGLVertexArrayObject;
  private probeVao: WebGLVertexArrayObject;
  private framebuffer: WebGLFramebuffer;
  private texture: WebGLTexture;
  private count = 0;
  private instances: number;
  readonly renderer: string;
  readonly triangles: number;
  constructor(
    private canvas: HTMLCanvasElement,
    heavy = true,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 2 is unavailable.');
    this.gl = gl;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.renderer = info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    this.instances = heavy ? 96 : 8;
    const data = mesh(heavy ? 256 : 32, heavy ? 48 : 8);
    this.count = data.indices.length;
    this.triangles = (this.count / 3) * this.instances;
    this.vao = gl.createVertexArray()!;
    this.probeVao = gl.createVertexArray()!;
    this.framebuffer = gl.createFramebuffer()!;
    this.texture = gl.createTexture()!;
    try {
      this.programs.push(this.program(vertex, fragment));
      this.programs.push(this.program(probeVertex, probeFragment));
      gl.bindVertexArray(this.vao);
      for (const [target, bytes] of [
        [gl.ARRAY_BUFFER, data.vertices],
        [gl.ELEMENT_ARRAY_BUFFER, data.indices],
      ] as const) {
        const buffer = gl.createBuffer()!;
        this.buffers.push(buffer);
        gl.bindBuffer(target, buffer);
        gl.bufferData(target, bytes, gl.STATIC_DRAW);
      }
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8UI, 16, 16);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('GPU verification buffer is unavailable.');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('GPU setup failed.');
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  private program(vs: string, fs: string) {
    const gl = this.gl,
      program = gl.createProgram()!;
    const shaders: WebGLShader[] = [];
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vs],
        [gl.FRAGMENT_SHADER, fs],
      ] as const) {
        const shader = gl.createShader(type)!;
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed.');
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program) || 'Shader link failed.');
      return program;
    } catch (error) {
      gl.deleteProgram(program);
      throw error;
    } finally {
      shaders.forEach((shader) => gl.deleteShader(shader));
    }
  }
  render(seconds: number) {
    const gl = this.gl;
    if (gl.isContextLost()) throw new Error('GPU context lost.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.09, 0.1, 0.11, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const program = this.programs[0];
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(gl.getUniformLocation(program, 'time'), seconds);
    gl.uniform2f(
      gl.getUniformLocation(program, 'grid'),
      this.instances === 8 ? 4 : 8,
      this.instances === 8 ? 2 : 6,
    );
    gl.uniform1f(gl.getUniformLocation(program, 'aspect'), this.canvas.width / this.canvas.height);
    gl.drawElementsInstanced(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0, this.instances);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('GPU rendering error.');
  }
  verify(seed: number) {
    const gl = this.gl,
      pixels = new Uint8Array(16 * 16 * 4),
      program = this.programs[1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, 16, 16);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.DITHER);
    gl.useProgram(program);
    gl.bindVertexArray(this.probeVao);
    gl.uniform1ui(gl.getUniformLocation(program, 'seed'), seed >>> 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 16, 16, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, pixels);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('GPU readback error.');
    for (let i = 0; i < 256; i++) {
      const expected = hash(i ^ seed);
      for (let b = 0; b < 4; b++)
        if (pixels[i * 4 + b] !== ((expected >>> (8 * b)) & 255))
          throw new Error('GPU verification mismatch.');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  dispose() {
    const gl = this.gl;
    this.buffers.forEach((b) => gl.deleteBuffer(b));
    this.programs.forEach((p) => gl.deleteProgram(p));
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.probeVao);
    gl.deleteTexture(this.texture);
    gl.deleteFramebuffer(this.framebuffer);
  }
}
