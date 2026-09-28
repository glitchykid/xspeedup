import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
export const dotnet = existsSync('.tools/dotnet/dotnet.exe')
  ? path.resolve('.tools/dotnet/dotnet.exe')
  : 'dotnet';
export const dotnetEnvironment = {
  ...process.env,
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_NOLOGO: '1',
  DOTNET_CLI_HOME: path.resolve('.cache/dotnet'),
  DOTNET_ADD_GLOBAL_TOOLS_TO_PATH: 'false',
  NUGET_PACKAGES: path.resolve('.cache/nuget'),
};
if (process.argv[1]?.endsWith('dotnet.mjs')) {
  const child = spawn(dotnet, process.argv.slice(2), { stdio: 'inherit', env: dotnetEnvironment });
  child.on('error', (error) => {
    console.error(`Install the .NET 10 SDK: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
