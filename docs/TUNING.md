# Hardware testing and automatic tuning

## Capability discovery

The application queries the installed NVIDIA NVML driver dynamically, by device UUID, for core and memory clock-offset ranges and GPU temperature. It uses the current `nvmlDeviceGetClockOffsets` / `nvmlDeviceSetClockOffsets` API and its versioned `nvmlClockOffset_t` structure, not deprecated offset APIs or private driver entrypoints. The DLL is loaded only from Windows System32. Missing APIs, permissions, sensors or unsupported ranges disable tuning with a diagnostic. A driver can still reject the first write despite allowing inspection.

The current tuning adapter supports **one NVIDIA GPU**. The WebGL renderer must identify that same device; software renderers and ambiguous/multiple devices cannot enter automatic tuning. CPU identity is detected, but CPU multipliers, system RAM timings, firmware controls and AMD/Intel GPU tuning adapters are not implemented. These controls are shown as unavailable, never simulated. Optional CPU/RAM testing remains available independently of clock control.

## User flow and bounds

1. Open **Tests & tuning**. Review automatically detected capabilities. Administrator rights are required for clock writes.
2. A standalone test draws the custom scene without changing clocks. Choose a duration and optional CPU/RAM workers.
3. **Automatic tuning** presents a native confirmation, saves the original offsets, and arms an independent recovery process before changing clocks.
4. The baseline runs for at least 45 seconds. Core candidates add 15, 30 and 45 MHz to the original offset. If supported, memory candidates add 50 and 100 MHz while retaining the highest core candidate. Driver limits always take precedence.
5. Each candidate is checked for at least 45 seconds; the last runs for at least 120 seconds. The native agent enforces timing. The UI additionally requires rendered frames and repeated successful GPU probes.
6. Successful candidates and frame statistics are shown. **Original offsets are restored at completion, cancellation or detected failure.** This release does not permanently apply a tested profile. A failed stage is not marked as passed; the journal retains the preceding passed offsets.

Start requires GPU temperature below 65 °C. The stop threshold is 75 °C, the heartbeat lease is 15 seconds, and session duration is limited to 20 minutes. Voltage, power limits, fan curves and firmware stay unchanged. Switching away/minimizing stops the renderer test. Unknown temperature prevents automatic tuning; standalone graphics can run without a sensor and cannot then enforce a thermal threshold. CPU temperature monitoring is not implemented.

## Original workload and verification

The WebGL 2 workload is implemented in `src/lib/stress/`. A deformed procedural torus mesh is instanced and animated with derivative normals, lighting, specular/fresnel effects and iterative procedural shading. Heavy mode submits **2,359,296 triangles per frame** at a bounded canvas resolution; low mode submits 4,096. No downloaded benchmark or external game engine is embedded.

Once per second, a separate integer shader renders a changing deterministic hash into a 16 × 16 RGBA8UI target. Readback is compared byte-for-byte against the CPU reference. Context loss, graphics errors, mismatches or stalled rendering abort the run. This probe checks one computation path and a small render target; it is not exhaustive VRAM coverage or a guarantee that every visual artifact will be detected.

Optional workers exercise deterministic memory patterns and inverted reads in 16 MiB buffers, up to eight workers and 128 MiB total. Mismatches/worker errors stop the run. This is a bounded CPU/RAM workload, not exhaustive physical-memory testing. Frame statistics include FPS, mean of the slowest 1% of frames, P95 and P99 frame times. Display synchronization can cap FPS, so results are not an uncapped benchmark or proof that a clock increment improved game performance.

## Recovery

The original and intended offsets are flushed to the local journal before a write. The independent agent process checks the journal/temperature every two seconds under a per-user mutex. If the heartbeat expires or a bound is violated, it attempts to restore original values. It survives a renderer/main-agent exit. Recovery checks current offsets before writing and preserves conflicting changes made by another program. A partial driver write can be recovered using either the previous or intended value recorded in the journal.

Driver failure, power loss, disk failure or a full system hang can prevent recovery. History retains incomplete sessions; they block a new tuning run until restoration succeeds. Recovery is not a guarantee against crashes, restarts or lost unsaved work. Do not delete the history directory while a tuning session or recovery is pending.

## Verification scope

Automated tests use injected driver/time/watchdog adapters to exercise bounded steps, backup ordering, early-step rejection, thermal/heartbeat stops, recovery after partial failure and external-change preservation. Development-machine NVML inspection and a three-second low-load GPU render/readback test do not change clocks. Live elevated clock writes, full-load behavior, driver-reset recovery and temperature accuracy still require acceptance on dedicated supported hardware. A VM alone cannot validate physical GPU overclocking.

## Official API references

- [NVIDIA NVML device queries and clock offsets](https://docs.nvidia.com/deploy/nvml-api/latest/api/group__nvmlDeviceQueries.html)
- [NVIDIA NVML public header](https://github.com/NVIDIA/go-nvml/blob/main/pkg/nvml/nvml.h)
- [WebGL 2.0 stable specification](https://registry.khronos.org/webgl/specs/2.0.0/)
- [Svelte reactive snapshots for external APIs](https://svelte.dev/docs/svelte/$state#$state.snapshot)
