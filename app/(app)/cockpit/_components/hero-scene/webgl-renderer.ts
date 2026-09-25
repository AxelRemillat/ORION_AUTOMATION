import { FRAGMENT_GLSL, VERTEX_GLSL } from "./scene.glsl";

/** Ce que la boucle transmet à chaque image. */
export interface SceneFrame {
  time: number;
  night: number;
  flash: number;
  mouse: [number, number];
  sun: [number, number];
  moon: [number, number];
}

export interface SceneRenderer {
  resize(width: number, height: number): void;
  render(frame: SceneFrame): void;
  dispose(): void;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn("[hero-scene] shader :", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

/** Renderer WebGL 1, ou `null` si le contexte ou le shader est indisponible. */
export function createWebGLRenderer(canvas: HTMLCanvasElement): SceneRenderer | null {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
  if (!gl) return null;

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_GLSL);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_GLSL);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  // Un triangle qui couvre tout l'écran.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    res: u("uRes"), time: u("uTime"), night: u("uNight"), flash: u("uFlash"),
    mouse: u("uMouse"), sun: u("uSun"), moon: u("uMoon"),
  };

  return {
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uniforms.res, width, height);
    },
    render(frame) {
      // Le temps est replié : un float highp perd en précision au-delà.
      gl.uniform1f(uniforms.time, frame.time % 2000);
      gl.uniform1f(uniforms.night, frame.night);
      gl.uniform1f(uniforms.flash, frame.flash);
      gl.uniform2f(uniforms.mouse, frame.mouse[0], frame.mouse[1]);
      gl.uniform2f(uniforms.sun, frame.sun[0], frame.sun[1]);
      gl.uniform2f(uniforms.moon, frame.moon[0], frame.moon[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}
