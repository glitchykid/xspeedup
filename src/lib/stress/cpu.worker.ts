import { hash } from './math';
let running = false;
let memory: Uint32Array;
let pass = 0;
let seed = 0;
let compute = false;
onmessage = (event: MessageEvent<{ seed: number; bytes: number; cpu: boolean }>) => {
  if (running) return;
  memory = new Uint32Array(Math.max(1024, Math.min(event.data.bytes, 32 * 1024 * 1024)) / 4);
  seed = event.data.seed >>> 0;
  compute = event.data.cpu;
  running = true;
  setTimeout(cycle, 0);
};
function cycle() {
  let errors = 0;
  if (compute) {
    // Dense floating-point matrix multiplication checked against an independent closed form.
    const n = 96,
      a = new Float64Array(n * n),
      b = new Float64Array(n * n);
    const shift = (seed + pass) % 31;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < n; k++) {
        a[i * n + k] = i + k + 1 + shift;
        b[k * n + i] = (k + 1) * (i + 1);
      }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++) sum += a[i * n + k] * b[k * n + j];
        const expected =
          (j + 1) * (((i + shift) * n * (n + 1)) / 2 + (n * (n + 1) * (2 * n + 1)) / 6);
        if (sum !== expected) errors++;
      }
  }
  const salt = (seed + pass) >>> 0;
  for (let i = 0; i < memory.length; i++) memory[i] = hash(i ^ salt);
  for (let i = memory.length - 1; i >= 0; i--) if (memory[i] !== hash(i ^ salt)) errors++;
  // Invert the pattern as a second data-dependent pass.
  for (let i = 0; i < memory.length; i++) memory[i] = ~memory[i];
  for (let i = memory.length - 1; i >= 0; i--) if (memory[i] !== ~hash(i ^ salt) >>> 0) errors++;
  const bit = (1 << (pass % 32)) >>> 0;
  memory.fill(bit);
  for (let i = memory.length - 1; i >= 0; i--) {
    if (memory[i] !== bit) errors++;
    memory[i] = ~bit;
  }
  for (let i = 0; i < memory.length; i++) if (memory[i] !== ~bit >>> 0) errors++;
  postMessage({ passes: ++pass, errors, bytes: memory.byteLength });
  if (!errors) setTimeout(cycle, 0);
}
