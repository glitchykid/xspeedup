export function hash(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}
export function frameStats(samples: number[]) {
  const valid = samples.filter((x) => Number.isFinite(x) && x > 0);
  if (!valid.length) return { fps: 0, low: 0, p95: 0, p99: 0 };
  const sorted = [...valid].sort((a, b) => a - b);
  const slow = sorted.slice(-Math.max(1, Math.ceil(sorted.length * 0.01)));
  const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length;
  return {
    fps: 1000 / mean(valid),
    low: 1000 / mean(slow),
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    p99: sorted[Math.ceil(sorted.length * 0.99) - 1],
  };
}
export function mesh(segments: number, sides: number) {
  const vertices: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= segments; i++)
    for (let j = 0; j <= sides; j++) {
      const u = (i / segments) * Math.PI * 2,
        v = (j / sides) * Math.PI * 2;
      const radius = 1.25 + 0.22 * Math.cos(3 * u);
      vertices.push(
        (radius + 0.32 * Math.cos(v)) * Math.cos(u),
        0.32 * Math.sin(v) + 0.4 * Math.sin(3 * u),
        (radius + 0.32 * Math.cos(v)) * Math.sin(u),
      );
    }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
