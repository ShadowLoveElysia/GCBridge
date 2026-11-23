# Platform detection and binary delivery

## Codex locations

The official Codex home-dir implementation uses `CODEX_HOME` when set; otherwise the current OS user's `~/.codex`. CLI and Desktop can share that directory; an executable/app install location is not a config root. The GUI detects them separately but warns when the selected configuration root is shared. Users can edit the destination before injecting. A shell profile or Desktop-launched environment can differ from GCBridge's environment; detected paths are candidates, not proof of which backend is active.

| Target | Detection | Injection |
| --- | --- | --- |
| Windows CLI | PATH, `.exe/.cmd/.ps1`, user npm/local paths | Native config root; compiled GCBridge.exe mcp |
| Windows Desktop | Get-AppxPackage OpenAI.Codex install metadata and common per-user locations | Desktop-selected config root; native backend by default |
| macOS CLI | PATH then Homebrew Intel/Apple Silicon and user local candidates | CODEX_HOME or ~/.codex |
| macOS Desktop | /Applications/Codex.app, ~/Applications/Codex.app, Spotlight candidate search | Desktop-selected config root, no assumption that Library app state is the Codex MCP config |
| Linux CLI | PATH and user local candidate | CODEX_HOME or ~/.codex |
| Linux Desktop | No single guaranteed install layout | User must confirm install/config; CLI existence is insufficient |
| WSL CLI from Windows | Enumerate user distributions, probe target HOME/CODEX_HOME/PATH with sh | Linux config path in selected distro; mapped Windows exe via interop, or use native Linux GCBridge separately |
| Desktop WSL backend | Explicit manual choice for each distro | Only use if Desktop actually runs that backend; never infer from WSL presence |

WSL probes skip docker-desktop/data and podman system distribution. Linux shell PATH may resolve Windows wrappers; the UI reports that limitation. Paths use wslpath conversion, not assumptions about the automount root. Windows exe called from WSL shares the Windows user backend/keys. It cannot interpret a Linux file path as a Windows path; the current bridge accepts explicitly selected text and treats workspace as an identifier, not a path to scan.

Native injection uses a lock file, content fingerprint check, temporary write and rename; malformed TOML is rejected. WSL config writes use target-side locking and content hashes. No auth.toml or credential stores are read for detection. Connection metadata records the injected command/target so a moved or missing entry can be diagnosed; no automatic repair or unsolicited rewrite.

## Building

Build inputs are pinned npm dependencies and Bun 1.4.5. scripts/build.ts bundles source and text resources, and supplies the published Oh My Pi loader with embedded zstd native frames tagged by OS/architecture/version/hash. Extraction happens in the user's native cache before model SDK imports. The packaged executable self-spawns its daemon command; it never tries to execute a missing daemon.ts file.

Actions use native Windows/macOS/Linux hosts, external runner temporary directories, no test jobs and no credentials. macOS `.app` is ad-hoc signed, not Developer ID signed/notarized. Linux tar archives preserve executable mode. Windows `.exe` is unsigned. Artifacts include notices and SHA256SUMS. Compilation success alone is not runtime acceptance; only locally exercised platforms can be reported tested.

Official source checked: https://github.com/openai/codex/blob/main/codex-rs/utils/home-dir/src/lib.rs . It establishes configuration precedence; app installation probes are platform-specific best-effort heuristics and editable by the user.

macOS component status reports Rosetta translation using sysctl.proc_translated when available; source bootstrap chooses native arm64 on translated Apple Silicon shells. Build scripts ad-hoc sign native addons before embedding and the app bundle after packaging; no Developer ID or notarization is implied.
