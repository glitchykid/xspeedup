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

`RegistryMaintenance` has a fixed target catalog: Run/RunOnce values, leaf children of App Paths/Uninstall under HKCU (native view) and HKLM (32/64-bit views), and empty non-system application leaves up to three levels below HKCU Software. HKLM writes need administrator rights. No arbitrary paths are accepted from the renderer or a backup outside this catalog.

Startup commands must be empty strings or unambiguous absolute missing executables. App Paths targets must be missing executables. Uninstall leftovers require a missing install directory and uninstaller, plus missing additional executable/icon references when present. MSI/system/child-component entries, missing evidence, ambiguous commands, network/removable/offline paths and redirected ancestors are excluded. Empty means zero values and zero child keys; an arbitrary empty string outside startup is not considered disposable.

Supported snapshot types are string, expandable string, DWORD, QWORD, binary, multi-string and none. Unsupported/malformed types and oversized values are skipped. Entries containing child keys are not removed recursively. A transaction re-reads the key/value and compares the snapshot before deletion. Unavailable transactions cause a skip/error rather than an unsafe fallback. Backups are flushed first. Restores preserve changed keys/values, recreate only a leaf whose parent still exists, and can be retried. Recreated keys inherit the parent's permissions; custom ACLs/auditing metadata are not backed up. Legacy startup backups remain restorable. Empty keys may still have meaning to an installed program, so review the list; no performance benefit is promised.

## Empty folders

This tool scans a native-picker-selected folder or all available fixed/removable local drives. Slices run for up to two seconds or 10,000 traversal steps and continue automatically. There is no result/depth cutoff. Completion is reported only after permitted traversal is exhausted; inaccessible paths are counted as skipped. Canceling leaves an incomplete, nondeletable scan. Network drives, inaccessible paths, protected system/application trees, the current user's AppData, known profile roots, reparse points, `.git`, `.svn`, `.hg` and `node_modules` are excluded. Protected profile roots can be traversed but never removed; protected trees are not traversed.

Complete selection uses an agent-owned manifest and the literal `all`; partial selections accept up to 100,000 manifest IDs. The selected root and drive roots cannot be deleted. Before deletion the agent verifies containment, ancestor links, final path, volume/file identity, creation time and directory attributes. Windows refuses deletion if the directory has become nonempty; no recursive delete is issued. Directory handles used for traversal are closed first. Parent folders are not automatically removed. Deletion bypasses the Recycle Bin and has no recovery backup. A scan is not proof that an empty folder is unnecessary.

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

## Balanced Game Mode

Game Mode is a separate session from permanent service-startup profiles. It snapshots the current `HKCU\Software\Microsoft\GameBar\AutoGameModeEnabled` value (absent, 0 or 1), uses transactional compare/exchange, and enables it. An unavailable or malformed setting disables activation and offers the Windows Settings page. The only stoppable services are DiagTrack, MapsBroker and Fax, explicitly selected and running at activation. SCM rejects dependent-service conflicts; the app does not stop dependencies. Service startup modes and power plans are unchanged.

The journal is saved before each transition. Ending the session restores the prior Game Mode value and restarts services stopped by the session. Save prompts belong to the selected applications; closure is not forced and closed apps are not automatically reopened. A failed restore remains available in History, including after restart. A service externally stopped during the session may be restarted because the app cannot establish ownership of every external transition. FPS improvement is not guaranteed.

References: [Windows Game Mode setting](https://learn.microsoft.com/en-us/windows/apps/develop/settings/settings-windows-11), [Windows Settings URI](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings), [SCM stop semantics](https://learn.microsoft.com/en-us/windows/win32/services/stopping-a-service).

## Hardware tests and tuning

See [TUNING.md](TUNING.md) for detected capabilities, exact increments, independent recovery, load bounds and the unverified live-hardware acceptance scope. Tuning changes clocks only during an explicitly confirmed bounded session and restores original offsets at the end. CPU/system RAM/SSD clock controls are unavailable in this release.

## Visible applications

Only accessible applications with top-level windows in the current interactive session are listed. A denylist and Windows-directory exclusion protect core OS and application-host processes. A process ID and creation time are revalidated at action time to avoid acting on a reused PID. The agent sends `CloseMainWindow`; it never kills a process or process tree. A successful result means the close request was sent, not that the application has exited or memory has already been freed. Handle save prompts in that application's window and refresh the list.

## Backups and practical limits

Memory release uses the same visible-process eligibility and PID/start-time checks as normal application closure, then calls `EmptyWorkingSet` through that process's handle. It never closes the process, changes standby-list privileges or invokes an undocumented memory command. The returned byte count is a momentary working-set reduction, not globally freed/unique memory. Pages may return immediately, subsequent access may be slower and leaks are not fixed. Mutating memory tests use a fake adapter; real OS behavior requires VM acceptance testing.

Backups are local to the Windows account. They are not System Restore points and do not contain file contents. Keep the history directory to retain rollback capability. The app does not import arbitrary backups or edit arbitrary registry keys. A power loss or disk failure can interrupt an action; inspect the existing history and current state before retrying. Backups are not a substitute for normal system/file backups.

Acceptance checks for registry transaction writes/restoration, real working-set trimming and live service startup modes should run in a disposable VM, with administrative rights where required. Automated mutation tests use in-memory adapters or isolated filesystem fixtures. Read-only desktop tests never execute maintenance operations on the host machine.
