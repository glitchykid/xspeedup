# Verification — 0.1.0

Verified on 2026-09-28 on a Windows 10 x64 desktop.

| Check | Result |
| --- | --- |
| Svelte diagnostics | 0 errors, 0 warnings |
| TypeScript 7 compilation checks | Passed |
| .NET compilation | 0 errors, 0 warnings |
| Native regression harness | 30 assertions passed |
| TypeScript tests | 3 tests passed |
| Development Electron integration | All six screens passed |
| Packaged Electron integration | All six screens passed, without `DOTNET_ROOT` |
| Renderer isolation and denied arbitrary IPC | Passed in Electron integration |
| Production UI and self-contained Windows agent | Built |
| Windows x64 NSIS installer | Built |
| npm dependency audit at installation | 0 reported vulnerabilities |

Native regression tests cover containment and traversal rejection, age filtering, scan replay/unknown selections, changed and locked file handling, deletion accounting, persistent journals, ambiguous startup commands, backup-before-write ordering, registry type restoration, external-change conflicts, catalog restrictions, and retrying partial service restoration.

The integration smoke reads actual system metrics, scans files and startup entries, displays services, filters applications, and opens history. It performs no host file deletion, live registry/service modification, or application closure. Actual administrator writes and restoration through Windows service APIs still require acceptance testing in a disposable VM. The NSIS installer was built; installation/uninstallation were not run on the development machine. The included unpacked executable was launched and verified.

The installer is unsigned. No certificate or publishing credentials are included in the repository. Local screenshots and generated binaries are excluded from Git.
