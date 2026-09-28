import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
import { dotnet, dotnetEnvironment } from './dotnet.mjs';
import './build-electron.mjs';
const build = spawn(dotnet, ['build', 'native/XSpeedUp.Agent', '-c', 'Debug'], {
  stdio: 'inherit',
  env: dotnetEnvironment,
});
await new Promise((resolve, reject) => {
  build.on('error', reject);
  build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Agent build failed'))));
});
const server = await createServer();
await server.listen();
const environment = { ...process.env, XSPEEDUP_DEV: '1' };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env: environment });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => child.kill());
