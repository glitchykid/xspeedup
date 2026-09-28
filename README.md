# X SpeedUp

A Windows desktop maintenance app with an Electron + Svelte interface and a C#/.NET agent. Inspect disk and memory usage, remove old temporary files, review stale startup registry values, choose optional service profiles, and close unused applications. The interface is in Russian; project documentation is in English.

**Status:** version 0.2.0 for Windows x64, with a brutalist interface and light/dark themes. Operations are explicit, local, and reviewed before execution. There is no automatic optimization, telemetry, or promise of a particular performance gain.

## Interface and themes

The interface uses a brutalist visual language: bold typography, square panels, strong borders, solid lime/violet accents, and hard offset shadows. These styles cover all six screens, including lists, notices, disabled controls, selection states, and keyboard focus.

Use **Светлая** (Light) or **Тёмная** (Dark) in the top bar to switch themes without losing the current page, scan, or selection. The first launch follows the Windows color preference. An explicit choice is saved locally and takes priority on subsequent launches. Theme changes do not execute any maintenance action. If local preference storage is unavailable, switching still works for the current session.

The layout supports the app's minimum 1020 × 720 window size and respects reduced-motion preferences. Native Windows confirmation dialogs retain the operating system's appearance.

## Features

| Tool             | What it does                                                                                                                                                   | Recovery                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| System overview  | Actual system drive space, physical memory usage, logical processor count and uptime                                                                           | Read-only                                                  |
| File cleanup     | Current user's Temp and DirectX shader cache older than 7 days; CrashDumps older than 14 days                                                                  | Permanent deletion; no file backup                         |
| Registry cleanup | Stale string values in the current user's `Software\Microsoft\Windows\CurrentVersion\Run` key, pointing to missing absolute `.exe` paths on local fixed drives | Original value and registry type backed up before deletion |
| Service profiles | Explicit selection of optional services with per-service impact descriptions                                                                                   | Original startup mode backed up before modification        |
| Applications     | Memory usage and normal close requests for eligible visible applications in the current session                                                                | Applications handle their own save prompts                 |
| History          | Recent maintenance operations, backups and partial restore conflicts                                                                                           | Registry/service restores available in the app             |

Service profiles are **No maps or fax**, **Less telemetry**, and **No Xbox**. A profile only selects entries; it does not execute anything. Disabling changes startup behavior after a restart and does not stop currently running services. Microsoft Defender, Windows Update, core networking, storage, and other critical services are not in the writable catalog.

## Run from source

Requirements: Windows 10/11 x64, **Node.js 24 LTS** (24.21.0), npm, and **.NET 10 LTS SDK** (10.0.401 or a compatible patch). The SDK may also be installed privately at `.tools/dotnet`.

```powershell
npm ci
npm run dev
```

This builds the Windows agent, starts Vite on `127.0.0.1:5173`, and opens Electron. Svelte changes update live. Restart `npm run dev` after changing Electron or C# code.

To run the production build:

```powershell
npm run build
npm start
```

`npm run dev:web` opens the interface in a browser for layout work. It explicitly labels itself as a preview; Windows operations and fabricated system readings are not provided there.

## Windows installer

```powershell
npm run package
```

Output: `release/X SpeedUp Setup 0.2.0.exe`, with an unpacked application in `release/win-unpacked/`. The installer includes the .NET runtime; end users do not need Node.js or .NET installed. The first packaging run downloads Electron and NSIS build tools.

The build is unsigned unless a code-signing certificate is configured in your environment. Windows may display an unknown-publisher prompt. No signing credentials are stored in this repository. `npm run package` creates local artifacts. Installers are also published through the version-tag release workflow described below.

Download published installers from [GitHub Releases](https://github.com/glitchykid/xspeedup/releases).

Normal cleanup, inspection, and current-user registry operations use standard permissions. For service changes/restores, launch the installed application with **Run as administrator** using the same Windows account. The app does not elevate itself automatically. Elevated execution under a different account targets that account's registry and backup folder.

## Maintenance workflow

1. Start with **Analyze system** or a tool-specific scan.
2. Review categories/entries and select what you want to change. Cleanup and registry items are unselected by default.
3. Read the native confirmation dialog. File deletion is permanent; registry/service operations have backups.
4. Review changed/skipped counts and error details. Locked or changed files are skipped.
5. Open **History** to restore registry values or service startup modes. Restart Windows after changing or restoring service startup modes.

Backups and history are stored in `%LOCALAPPDATA%\XSpeedUp\history` as JSON. They include original startup commands and service modes, so treat them as private local data. Keep this folder if you want to restore settings after reinstalling. The UI displays the latest 100 records; older files remain on disk.

## Verification

```powershell
npm run check       # Svelte diagnostics and TypeScript 7 checks
npm test            # Native filesystem fixtures, in-memory recovery tests, IPC tests
npm run build       # Production renderer, Electron main/preload, self-contained agent
npm run test:desktop # Real Electron / Windows read-only integration smoke test
npm run test:desktop -- --packaged # Same checks against release/win-unpacked after packaging
```

The native test harness creates disposable fixtures under `.cache/tests` and uses in-memory registry/service adapters. It never cleans a real temporary folder, edits the live registry, changes a live service, or closes a user's app. Fixtures are retained for inspection. The desktop smoke test reads actual Windows state, checks all six screens in both themes, verifies theme persistence/system fallback/keyboard controls, and checks the minimum window size. It restores the previous saved theme on completion. Screenshots in `artifacts/screenshots` are excluded from Git because they contain device information.

GitHub Actions runs Windows build and native/type checks. The interactive desktop smoke test is intended for a logged-in Windows desktop session. Real administrator service writes still need acceptance testing in a disposable Windows VM; they are deliberately not performed on the development machine.

## Publishing a release

1. Update `package.json`, the lockfile, displayed version, changelog, and `docs/releases/<version>.md`.
2. Verify and commit the changes, then push the branch.
3. Create an annotated `v<version>` tag matching `package.json` and push that tag.
4. The **Publish Windows release** workflow runs native tests, checks types, builds the self-contained agent and NSIS installer, then publishes the installer and `SHA256SUMS.txt` to GitHub Releases.

The workflow uses the repository's short-lived `GITHUB_TOKEN` with `contents: write`; a personal token is not needed. Failed builds do not publish a release. Packaging tools are downloaded automatically when needed; on Windows, missing development tools can also be installed with winget.

## Technology versions

Versions were checked against stable releases on **2026-09-28**, with LTS preferred where available.

| Component            | Version                                   |
| -------------------- | ----------------------------------------- |
| .NET SDK / C#        | 10.0.401 LTS / C# 14                      |
| Node.js              | 24.21.0 LTS                               |
| Electron             | 44.4.5                                    |
| Svelte               | 5.57.1 (runes, event attributes, `mount`) |
| TypeScript compiler  | 7.0.2                                     |
| Vite / Svelte plugin | 8.3.1 / 7.3.1                             |
| electron-builder     | 26.15.3                                   |

**TypeScript compatibility:** TypeScript 7 has no JavaScript compiler API. `svelte-check` 4.7.6 requires the TypeScript 5/6 API. The project follows Microsoft's documented side-by-side arrangement: `@typescript/native` aliases TypeScript 7.0.2 for `tsc`, while `typescript` aliases the official `@typescript/typescript6` 6.0.2 compatibility package for Svelte tooling. This is intentional; npm peer checks are not bypassed. See the [TypeScript 7 release notes](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

See [architecture](docs/ARCHITECTURE.md), [maintenance scope and recovery](docs/SAFETY.md), and the [changelog](CHANGELOG.md).

## Official references

- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) and [security recommendations](https://www.electronjs.org/docs/latest/tutorial/security)
- [Svelte 5 documentation](https://svelte.dev/docs/svelte/overview)
- [.NET 10 downloads](https://dotnet.microsoft.com/en-us/download/dotnet/10.0)
- [Windows service configuration](https://learn.microsoft.com/en-us/windows/win32/services/service-configuration)
- [Microsoft's registry cleaner support policy](https://support.microsoft.com/en-us/topic/microsoft-support-policy-for-the-use-of-registry-cleaning-utilities-0485f4df-9520-3691-2461-7b0fd54e8b3a)
