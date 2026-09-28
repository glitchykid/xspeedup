# Architecture

## Design

X SpeedUp is a local Windows x64 application, delivered as three small layers:

```text
Svelte renderer (unprivileged interface)
    -> typed contextBridge API
Electron main (validation, trusted native confirmations, serialized operations)
    -> private stdin/stdout JSON lines
C# Windows agent (target policy, inspection, file operations, registry, services)
```

There is no HTTP backend, background service, arbitrary command execution API, or database. The agent runs only while Electron needs it. OS settings and files are changed solely by explicit maintenance requests; application settings/history and Electron's own browser cache are normal local application data.

The first vertical slice is **scan files -> select categories -> native confirmation -> verify current file -> delete -> display result and history**. Registry, service, and application tools reuse the same request/response and confirmation boundary. Domain-specific policy stays in the agent instead of being inferred by the interface.

## Source map

- `src/`: Svelte 5 UI, shared icon component, display formatting.
- `shared/contracts.ts`: typed request and response contracts for the renderer and Electron.
- `electron/validation.ts`: strict method/argument allowlist.
- `electron/main.ts`: trusted sender checks, native confirmation dialogs, one operation at a time, application lifecycle.
- `electron/agent.ts`: private process transport, response correlation, crash/timeout handling.
- `native/XSpeedUp.Agent/`: small Windows-focused C# components, with no external NuGet packages.
- `native/XSpeedUp.Tests/`: executable regression harness with filesystem fixtures and in-memory registry/service adapters.
- `tests/`: IPC rejection and display-format tests.
- `scripts/`: development, build, launch, and read-only desktop verification.

## Trust boundary

The renderer uses `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, a restrictive CSP, denied permissions, and blocked navigation/new windows/webviews. Only the app's main frame may invoke the dedicated IPC handler. Renderer-controlled paths and shell commands are not accepted.

The agent accepts fixed operation names and category/service IDs. Cleanup and registry changes require an in-memory, single-use scan ID, valid for 15 minutes. The renderer never owns the file manifest. A crashed/restarted agent therefore invalidates old scans.

Electron serializes requests and holds a native confirmation dialog before each mutation. The dialog uses agent-provided records rather than trusting display strings from the renderer. Running windows are kept open during active work. The agent has a two-minute watchdog; an interrupted operation is never automatically retried. Its error instructs the user to inspect history and rescan.

The stdio executable is an implementation component and does not provide its own graphical confirmation when invoked directly. Its fixed target policies remain enforced. It inherits the launching user's rights; it is not a privilege escalation service.

## Persistence and recovery

Each registry/service operation writes and flushes a journal before a change. Files use a unique temporary name and atomic replacement. Backups preserve original registry value types/strings or the original service startup modes. Restores record progress per entry and preserve conflicting current values. No crash-consistency claim is made across an OS registry/service mutation and its following journal update; retry logic handles already-restored values, and the backup remains available if the process dies in between.

File cleanup records an audit entry before starting and a count/result after completion. It deliberately does not store deleted contents. A crash can leave the initial audit record and partially completed deletion; the next scan establishes current state.

## Build and version policy

The runtime includes .NET 10 LTS. Node 24 LTS drives the development tools. Electron, Svelte, Vite, and the TypeScript 7 CLI use verified stable versions. Dependencies are locked in `package-lock.json`; update the lockfile and run verification when upgrading. Svelte's checker uses Microsoft's TypeScript 6 compatibility API as documented in README.md. No obsolete Svelte component creation or event directive APIs are used.

Packaged applications start the self-contained agent under `resources/agent`. Development starts the Debug build and resolves a private `.tools/dotnet` SDK only when present. A packaged agent is used by `npm start` after `npm run build`.
