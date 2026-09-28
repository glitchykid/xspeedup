import { hash } from './math';
let running = false;
let memory: Uint32Array;
let pass = 0;
let seed = 0;
onmessage = (event: MessageEvent<{ seed: number; bytes: number }>) => {
  if (running) return;
  memory = new Uint32Array(Math.max(1024, Math.min(event.data.bytes, 32 * 1024 * 1024)) / 4);
  seed = event.data.seed >>> 0;
  running = true;
  setTimeout(cycle, 0);
};
function cycle() {
  let errors = 0;
  const salt = (seed + pass) >>> 0;
  for (let i = 0; i < memory.length; i++) memory[i] = hash(i ^ salt);
  for (let i = memory.length - 1; i >= 0; i--) if (memory[i] !== hash(i ^ salt)) errors++;
  // Invert the pattern as a second data-dependent pass.
  for (let i = 0; i < memory.length; i++) memory[i] = ~memory[i];
  for (let i = memory.length - 1; i >= 0; i--) if (memory[i] !== ~hash(i ^ salt) >>> 0) errors++;
  postMessage({ passes: ++pass, errors, bytes: memory.byteLength });
  if (!errors) setTimeout(cycle, 0);
}
