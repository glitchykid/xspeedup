# X SpeedUp

A local Windows maintenance application built with Electron, Svelte, TypeScript and a C#/.NET agent. Inspect your computer, clean old temporary files, review application registry leftovers, find empty folders, manage optional services, and release an application's working set.

**Version 0.3.1 · Windows 10/11 x64.** [Download the installer from GitHub Releases](https://github.com/glitchykid/xspeedup/releases). The installer includes the .NET runtime; end users do not need Node.js or .NET installed separately. Installers are currently unsigned.

## Interface and languages

The Glass Morphism interface uses translucent surfaces, soft depth, original generated artwork, and generated application/navigation icons. Light and dark themes follow the system on first launch and remember an explicit selection. Active navigation colors stay selected when hovered.

The language selector supports **Russian, English, Ukrainian, Korean, Japanese and Simplified Chinese**. It initially follows a supported system language and otherwise uses English. Theme/language changes preserve scans and selections; both preferences are stored locally. Core screens, action explanations and native confirmation dialogs are translated. Windows diagnostic messages, registry value names, executable titles and historical diagnostic records retain their original text. These are available under **Technical details**, rather than being rewritten during recovery.

The minimum window size is 1020 × 720. The interface respects reduced-motion and reduced-transparency preferences. Generated asset provenance and prompts are in [Design assets](docs/DESIGN_ASSETS.md).

## Maintenance tools

| Tool          | Scope                                                                                                       | Recovery                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Overview      | Actual system drive space, available physical memory, logical CPUs and uptime                               | Read-only                                          |
| File cleanup  | Current user's Temp and DirectX shader cache older than 7 days; CrashDumps older than 14 days               | Permanent deletion                                 |
| Empty folders | Available fixed and removable local drives, with protected directory exclusions                             | Permanent deletion of empty leaves only            |
| Registry      | Stale/empty Run and RunOnce values, stale App Paths, qualifying Uninstall leftovers, empty application keys | Typed value/key snapshots before changes           |
| Services      | Six optional services in explicit profiles, with visible impact descriptions                                | Original startup modes saved                       |
| Apps & memory | Eligible visible apps in the current session; normal close requests or working-set trimming                 | No process termination; memory may be loaded again |
| History       | Local operation journal and registry/service restoration                                                    | Conflicting current settings are preserved         |

Nothing is optimized automatically. Every mutation requires selection and a native confirmation. There is no telemetry, arbitrary shell command API, or promise of a particular performance gain.

### Expanded registry cleanup

The analyzer inspects HKCU's native view and HKLM's 32-bit/64-bit views under `Software\Microsoft\Windows\CurrentVersion`:

- `Run` and `RunOnce`: empty string commands and unambiguous absolute executable paths whose files are missing.
- `App Paths`: missing absolute executable targets and genuinely empty leaf keys.
- `Uninstall`: leaf entries for non-MSI applications where the install directory **and** uninstaller are missing. Additional executable/icon references, when present, must also be unambiguously missing.
- Empty leaf keys up to three levels below `HKCU\Software`, excluding Microsoft, Classes, Policies and other protected roots.

Missing paths must be on available fixed local drives. Access failures, network/removable installation paths, registry links, MSI records, system components and keys containing subkeys are excluded. A missing installation directory alone is insufficient evidence. This does not attempt to guess arbitrary vendor leftovers or remove every key associated with a product name.

HKLM changes require administrator rights; inspection uses read-only handles. Snapshots preserve supported value types and unexpanded strings. Writes use Windows registry transactions and fail rather than falling back to unguarded writes if transactions are unavailable. Restores preserve conflicts and can be retried. Old startup-only backups remain supported. See [scope and recovery](docs/SAFETY.md) for limits.

### Empty folders on all local drives

Start a scan in **Empty folders**, then use **Continue scan** for remaining directories. Each scan slice is bounded to keep the interface responsive; results accumulate up to 5,000 entries. Select up to 256 paths per operation. Scanning never deletes anything.

System directories, Program Files, ProgramData, the current user's AppData, reparse points/junctions, development metadata such as `.git` and `node_modules`, and protected profile roots are excluded. Network drives are not traversed. A folder can be useful even when empty: inspect the results before confirming deletion.

The agent rechecks the path, volume, directory identity, creation time and empty state. Windows performs deletion through the verified handle and refuses nonempty folders. No recursive directory deletion is used. Newly empty parents are found by a later scan. Removed/disconnected drives, changed folders and access failures are skipped.

### Memory release

Use **Release memory** beside an eligible application in **Apps & memory**. The overview's memory shortcut opens that list. The app requests Windows `EmptyWorkingSet` for the selected process, identified by its PID and start time, without closing it. It reports the measured working-set reduction, **not** a guaranteed increase in system-wide free memory. Pages can be loaded again and subsequent access can be slower. This does not fix memory leaks or clear the system standby cache.

## Build and run

Development requirements: Windows x64, **Node.js 24 LTS (24.21.0)** and **.NET 10 LTS SDK (10.0.401 or compatible patch)**. A private SDK at `.tools/dotnet` is supported. Missing tools can be installed with winget on Windows.

```powershell
npm ci
npm run dev
```

```powershell
npm run build       # Renderer, Electron and self-contained agent
npm start           # Production app
npm run package -- --publish never
```

Installer output: `release/X-SpeedUp-Setup-0.3.1.exe`. The unpacked application is in `release/win-unpacked/`. The same filename is used in GitHub downloads and `SHA256SUMS.txt`. Packaging automatically converts the generated PNG application icon to Windows icon resources.

`npm run dev:web` provides a labeled browser-only preview, with no simulated Windows data or maintenance operations.

For service or HKLM changes/restores, launch the app with **Run as administrator** under the same Windows account. The app does not automatically elevate. Registry and service backups are stored in `%LOCALAPPDATA%\XSpeedUp\history`; keep this folder to retain recovery. Running under a different account uses that account's registry and history.

## Verification

```powershell
npm run check
npm test
npm run test:desktop
npm run test:desktop -- --packaged
```

Native tests use disposable filesystem fixtures and in-memory registry/service/process adapters for mutations. A read-only machine-registry check catches access regressions. Desktop tests inspect Windows without deleting files, changing live registry/services, trimming real applications or closing them. They cover seven screens, both themes, all six locales, active navigation hover, selection preservation, preference persistence, the minimum window size, and IPC isolation. Prior preferences are restored when tests finish.

Real registry transaction writes/restoration, administrative service changes and OS working-set trimming still require acceptance testing in a disposable Windows VM. Installation/uninstallation are not performed on the development machine. See [verification](docs/VERIFICATION.md).

## Release workflow

1. Update the package/lockfile/display version, changelog and `docs/releases/<version>.md`.
2. Verify, commit and push.
3. Push an annotated `v<version>` tag matching the package version.
4. GitHub Actions runs tests and builds the Windows installer, then publishes it with `SHA256SUMS.txt` using the repository's short-lived token.

Dependencies remain pinned to versions verified on 2026-09-28: .NET SDK 10.0.401 LTS / C# 14, Node 24.21.0 LTS, Electron 44.4.5, Svelte 5.57.1, TypeScript 7.0.2, Vite 8.3.1, Svelte plugin 7.3.1 and electron-builder 26.15.3. The native TypeScript 7 compiler runs alongside Microsoft's TypeScript 6.0.2 compatibility API because `svelte-check` requires that API; npm peer checks are not bypassed.

## Documentation and references

- [Architecture](docs/ARCHITECTURE.md), [maintenance scope](docs/SAFETY.md), [changelog](CHANGELOG.md)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Svelte 5](https://svelte.dev/docs/svelte/overview), [.NET 10](https://dotnet.microsoft.com/en-us/download/dotnet/10.0)
- [EmptyWorkingSet](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-emptyworkingset), [Uninstall metadata](https://learn.microsoft.com/en-us/windows/win32/msi/uninstall-registry-key), [registry transactions](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regopenkeytransactedw)
- [TypeScript 7 and the compatibility API](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
