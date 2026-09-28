# Verification

## 0.3.1 — 2026-09-28

- Retained the process handle before memory eligibility and identity checks, keeping working-set trimming bound to the same kernel process object if its PID is reused.
- Native regression harness: 60 assertions passed. TypeScript suite: 5 tests passed.
- Production Svelte diagnostics: 0 errors and 0 warnings; TypeScript and self-contained .NET builds passed.
- The Windows x64 installer `X-SpeedUp-Setup-0.3.1.exe` was built and reports product version 0.3.1.
- Packaged Electron integration passed for seven screens, both themes, all six locales, active-tab hover, preference persistence, generated assets, minimum window size, read-only Windows scans and IPC isolation.

No maintenance actions were executed against the host during desktop verification. The native OS mutation and installer installation/uninstallation acceptance limits described below still apply.

## 0.3.0 — 2026-09-28

- Native regression harness: 60 assertions passed. New coverage includes read-only HKLM access, protected scan roots, changed/nonempty/replaced folders, single-use manifests, typed registry snapshots, backup-before-delete ordering, conflicting restores, non-MSI removal evidence, and memory-process eligibility/identity checks.
- TypeScript suite: 5 tests passed, including complete six-language dictionaries and rejection of renderer-supplied paths or unbounded selections.
- Svelte diagnostics: 0 errors and 0 warnings; TypeScript and .NET builds passed.
- Development and packaged Electron integration passed for seven screens, light/dark themes and all six locales. Active navigation background/text colors are equal before and during hover.
- Theme/system fallback, keyboard theme controls, language persistence, selection preservation and renderer isolation passed. All localized screens fit the minimum window width; overview screenshots cover both themes at 1020 × 720.
- Generated hero and transparent navigation atlas load from packaged assets. PNG corner alpha and the atlas's 2:1 geometry were verified. The packaged executable has the generated application icon.
- Actual read-only registry scanning found candidates in the broader catalog; linked and malformed registry entries produced explicit skips.
- Windows x64 NSIS installer built as `X-SpeedUp-Setup-0.3.0.exe`, product version 0.3.0. The unpacked executable was tested without a development SDK dependency.

File/folder deletion tests use isolated fixtures. Registry/service/memory mutations use fake adapters; native registry inspection and Electron scans are read-only. A localized memory confirmation is intercepted and canceled when an eligible application is available. No real application's memory was trimmed and no host registry/service settings were changed. Windows registry transaction writes/restoration, OS working-set trimming, administrative service changes and installer installation/uninstallation still need disposable-VM acceptance testing. The installer is unsigned.

## 0.2.1 — 2026-09-28

- Production build and Svelte/TypeScript checks passed after the packaging correction.
- The local NSIS artifact is `X-SpeedUp-Setup-0.2.1.exe`, matching the release workflow and checksum filename.
- The installer reports product version 0.2.1. The complete read-only Electron smoke test also passed against the packaged executable, including all six screens in both themes, persistence, keyboard controls, and minimum window size.
- [Release workflow](https://github.com/glitchykid/xspeedup/actions/runs/36449704440) completed successfully. The [published installer](https://github.com/glitchykid/xspeedup/releases/tag/v0.2.1) was downloaded and its SHA-256 digest and filename matched `SHA256SUMS.txt`.

## 0.2.0 — 2026-09-28

- Svelte diagnostics: 0 errors and 0 warnings; TypeScript checks passed.
- All six screens inspected in light and dark themes using the Electron smoke test.
- The first launch follows the emulated system preference. A manual choice survives reload and takes priority over the system setting.
- The theme selector works with keyboard input and preserves an existing cleanup selection.
- Both themes fit the minimum 1020 × 720 application window without horizontal page overflow.
- Renderer isolation and arbitrary IPC rejection remain verified. No host maintenance actions are executed by the UI checks.
- The Windows x64 NSIS installer was built successfully, and the same themed smoke checks passed against the packaged executable without a development SDK dependency.

Generated screenshots are stored locally under `artifacts/screenshots/` with `-light` and `-dark` suffixes and are not committed. The previous saved theme is restored after the smoke test.

## 0.1.0

Verified on 2026-09-28 on a Windows 10 x64 desktop.

| Check                                          | Result                                        |
| ---------------------------------------------- | --------------------------------------------- |
| Svelte diagnostics                             | 0 errors, 0 warnings                          |
| TypeScript 7 compilation checks                | Passed                                        |
| .NET compilation                               | 0 errors, 0 warnings                          |
| Native regression harness                      | 30 assertions passed                          |
| TypeScript tests                               | 3 tests passed                                |
| Development Electron integration               | All six screens passed                        |
| Packaged Electron integration                  | All six screens passed, without `DOTNET_ROOT` |
| Renderer isolation and denied arbitrary IPC    | Passed in Electron integration                |
| Production UI and self-contained Windows agent | Built                                         |
| Windows x64 NSIS installer                     | Built                                         |
| npm dependency audit at installation           | 0 reported vulnerabilities                    |

Native regression tests cover containment and traversal rejection, age filtering, scan replay/unknown selections, changed and locked file handling, deletion accounting, persistent journals, ambiguous startup commands, backup-before-write ordering, registry type restoration, external-change conflicts, catalog restrictions, and retrying partial service restoration.

The integration smoke reads actual system metrics, scans files and startup entries, displays services, filters applications, and opens history. It performs no host file deletion, live registry/service modification, or application closure. Actual administrator writes and restoration through Windows service APIs still require acceptance testing in a disposable VM. The NSIS installer was built; installation/uninstallation were not run on the development machine. The included unpacked executable was launched and verified.

The installer is unsigned. No certificate or publishing credentials are included in the repository. Local screenshots and generated binaries are excluded from Git.
