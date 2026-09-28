# Changelog

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
