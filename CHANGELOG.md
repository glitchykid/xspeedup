# Changelog

## 0.5.0 — 2026-09-28

- Fixed select-all followed by individual deselection: hidden pages and filtered-out selections remain selected.
- Compact Gunmetal screens with adaptive pagination, nested Game Mode/hardware tabs and paginated diagnostics; primary screens and action controls fit the minimum window without scrolling.
- Replaced the application icon with a generated opaque X/lightning PNG; all internal icons are transparent antialiased PNGs.
- Dedicated fullscreen test window with graceful Esc/native-close cancellation and restricted IPC access.
- Original deferred GPU workload: complex procedural geometry, 16 moving lights, shadowed key light, SSAO, PCF shadows, GGX lighting, HDR/bloom and FXAA enabled by default.
- Independent CPU matrix checks and RAM hash/inversion/walking-bit checks.
- Displays live GPU/VRAM clocks, current offsets, driver maxima, temperature/power readings and motherboard/RAM/storage inventory before testing.
- User-selectable 10–120 second tuning steps, enforced by the native agent; final validation still requires 120 seconds and every candidate must be completed.

Clock writes remain limited to the supported single-NVIDIA NVML adapter and require administrator rights. CPU/RAM/SSD clock writes are not implemented; the UI reports the limitations. Zero software offset does not rule out factory overclocking. Original offsets are restored after testing. No voltage, power-limit, firmware or persistent startup tuning is added. This release does not claim Cyberpunk 2077-equivalent graphics or guaranteed hardware stability.

## 0.4.0 — 2026-09-28

- Added master checkboxes, mixed selection states and fixed action docks.
- Added native folder selection and automatic traversal to completion, removing the 5,000-folder/depth-128 cutoffs; paginated results and bulk deletion use the complete scan manifest.
- Added balanced Game Mode with Windows Game Mode, explicitly selected optional services/apps, persistent recovery and conflict-aware restoration.
- Added automatic NVIDIA capability discovery and experimental bounded GPU/VRAM clock testing, original-offset backups and an independent temperature/heartbeat recovery process. CPU/RAM and other GPU tuning adapters remain unavailable.
- Built an original WebGL 2 workload with animated geometry, procedural shading, integer GPU readback verification, frame-time metrics and optional bounded CPU/RAM worker checks.
- Reworked the interface into compact dark minimalism with Gunmetal surfaces, restrained accents and new generated icons.
- Fixed language preference timing and conversion of reactive selections before Electron IPC.
- Expanded native, IPC and desktop regression coverage for full folder traversal, gaming recovery and clock recovery.

## 0.3.1 — 2026-09-28

- Retain the selected process handle from eligibility/identity validation through working-set trimming, preventing a PID-reuse race if an application exits during the operation.

## 0.3.0 — 2026-09-28

- Replaced the brutalist interface with light/dark Glass Morphism and persistent preferences.
- Added original generated hero artwork, Windows application icon and navigation icon atlas.
- Added Russian, English, Ukrainian, Korean, Japanese and Simplified Chinese interface/confirmation translations.
- Fixed active navigation colors changing on hover.
- Expanded registry review to RunOnce, App Paths, qualifying removed-application Uninstall entries and empty application keys, with typed snapshots, transactional changes and conflict-aware restoration.
- Added incremental empty-folder scanning across local fixed/removable drives, protected directory exclusions and handle-verified nonrecursive deletion.
- Added selected-application working-set trimming with PID/start-time validation and measured results.
- Added regression coverage for changed folders, registry backup/restore conflicts, memory eligibility, localization and desktop preferences.

## 0.2.1 — 2026-09-28

- Use a stable installer filename without spaces so GitHub downloads and checksum entries match.

## 0.2.0 — 2026-09-28

- Reworked all six screens into a brutalist interface with sharp geometry, heavy typography, visible borders, solid accents and hard shadows.
- Added persistent light/dark themes and a theme selector available on every screen, using the system preference on first launch.
- Added clear keyboard focus, selected/disabled control states, reduced-motion support, and compact-window layouts.
- Extended Electron verification to both themes, persistence, keyboard operation, preserved selections and the minimum window size.
- Added version-tagged GitHub releases containing the Windows installer and SHA-256 checksum.

## 0.1.0 — 2026-09-28

- Added the Russian Electron/Svelte desktop interface and C#/.NET 10 LTS Windows agent.
- Added actual Windows overview metrics and bounded, age-based temporary-file analysis.
- Added explicit cleanup with handle-based path/metadata checks and audit history.
- Added targeted stale startup registry detection, backups and conflict-aware restoration.
- Added optional service profiles with impact descriptions and startup-mode rollback.
- Added visible-application memory inspection and normal close requests.
- Added typed IPC validation, isolated renderer, native confirmations and serialized operations.
- Added Windows CI, fixture-based native tests, read-only Electron smoke tests, and NSIS packaging.
