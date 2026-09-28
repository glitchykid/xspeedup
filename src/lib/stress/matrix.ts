type V = number[];
const normalize = (a: V): V => {
  const n = Math.hypot(...a);
  return a.map((v) => v / n);
};
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V, b: V) => a.reduce((sum, v, i) => sum + v * b[i], 0);
export function view(eye: V, target: V): number[] {
  const z = normalize(eye.map((v, i) => v - target[i])),
    x = normalize(cross([0, 1, 0], z)),
    y = cross(z, x);
  return [
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ];
}
export function multiply(a: V, b: V): Float32Array {
  return Float32Array.from({ length: 16 }, (_, i) => {
    const row = i % 4,
      col = Math.floor(i / 4);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
    return sum;
  });
}
export function perspective(aspect: number): number[] {
  const f = 1 / Math.tan(0.55),
    near = 0.1,
    far = 60;
  return [
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ];
}
export const orthographic = [1 / 12, 0, 0, 0, 0, 1 / 12, 0, 0, 0, 0, -2 / 40, 0, 0, 0, -1, 1];
