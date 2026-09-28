# Maintenance scope and recovery

## File cleanup

The only production roots are under the current user's Local Application Data directory:

| Category             | Root         | Minimum last-write age |
| -------------------- | ------------ | ---------------------- |
| Temporary files      | `Temp`       | 7 days                 |
| DirectX shader cache | `D3DSCache`  | 7 days                 |
| Crash reports        | `CrashDumps` | 14 days                |

Downloads, documents, browser profiles, Windows Installer caches, Windows Update storage, Prefetch, and system directories are not scanned. Removing shader cache may cause an initial recompile in games. Removing crash dumps removes those diagnostic records.

The scan stops after 50,000 visited entries or approximately 20 seconds and reports a partial result. Age is based on last modification, not proof that a file will never be needed. Selection and final confirmation are required. Samples show at most five paths per category.

The deletion path checks root containment, refuses reparse points/junctions on all ancestors, opens the file with a Windows handle, validates its final path, size and timestamp, and deletes through that same handle. File handles that cannot be opened with the required exclusive-write/delete-sharing constraints are skipped. Empty directories are not removed. The completed action reports counts and up to 30 skip details. There is no recycle-bin recovery.

## Registry

Only `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` is writable. Candidate values must be `REG_SZ` or `REG_EXPAND_SZ` and refer to an unambiguous, absolute `.exe` path on an available local fixed drive. Unknown access failures, relative commands, unquoted executable paths with spaces, scripts, network paths and removable drives are excluded.

The value, type, and executable absence are checked again before deletion. The original, unexpanded value is persisted first. Restore writes a value only if its name is absent; identical values are treated as already restored, and conflicting values/types are preserved. A reinstall can make a former stale entry useful, so review candidates. This is targeted startup hygiene, not a generic registry optimizer or proof of performance improvement.

## Services

Writable services are fixed in the C# catalog:

- `DiagTrack`: Windows diagnostics and telemetry.
- `dmwappushservice`: WAP push device-management routing; may be required for MDM-managed devices.
- `MapsBroker`: downloaded/offline maps.
- `Fax`: fax functionality.
- `XblGameSave`: Xbox cloud-save synchronization.
- `XboxNetApiSvc`: Xbox Live networking.

There is no universally unnecessary service. Profiles are contextual selections with visible consequences. Absent, already-disabled and nonstandard startup modes are not writable. Only Automatic (2) and Manual (3) are changed to Disabled (4). The service-control API changes the startup mode without stopping a running service or altering its account/dependencies. Existing delayed-auto-start configuration is not modified. Restart Windows to apply changes. Restoration returns only the original startup mode; it does not start services immediately.

Service changes and restoration require administrator rights. This release runs the whole desktop application at the user's chosen privilege level; a separately elevated, signed broker is a possible future hardening step, not an implemented feature. Do not load remote content or untrusted extensions into the application.

## Applications

Only accessible applications with top-level windows in the current interactive session are listed. A denylist and Windows-directory exclusion protect core OS and application-host processes. A process ID and creation time are revalidated at action time to avoid acting on a reused PID. The agent sends `CloseMainWindow`; it never kills a process or process tree. A successful result means the close request was sent, not that the application has exited or memory has already been freed. Handle save prompts in that application's window and refresh the list.

## Backups and practical limits

Backups are local to the Windows account. They are not System Restore points and do not contain file contents. Keep the history directory to retain rollback capability. The app does not import arbitrary backups or edit arbitrary registry keys. A power loss or disk failure can interrupt an action; inspect the existing history and current state before retrying. Backups are not a substitute for normal system/file backups.

Acceptance checks that change live service startup modes should be run in a disposable VM with administrative rights. Automated development tests use in-memory settings, and read-only desktop tests never execute maintenance operations on the host machine.
