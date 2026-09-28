# Changelog

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
