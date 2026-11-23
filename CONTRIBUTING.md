# Contributing

Use Bun 1.4.4 or newer. `bash launch.sh check` installs pinned dependencies into the external user cache; it does not create repository node_modules.

```sh
bash launch.sh check
bash launch.sh lint
bun src/release-check.ts
```

All tests run locally and stay outside this repository. Do not add regression tests, fixtures, screenshots, temporary databases or test-running CI steps to GitHub. Local test workspaces and temporary output belong in an external private work directory. GitHub CI runs only type, lint, syntax and tracked-file checks. Local protocol fixtures must never be described as paid-provider or creativity validation.

Extend the existing bridge and OMP adapters rather than adding another API client or workflow engine. Keep request validation in `protocol.ts`, configuration in `config.ts` and storage rules in `store.ts`. Do not create model-specific copies of shared collaboration logic. Include meaningful regression checks for lifecycle, cost and privacy behavior.

Native OMP types are checked against the pinned real coding-agent dependency. The extension-loading test uses the upstream loader, not a homemade extension API shim. Local HTTP fixtures test the actual OMP provider and MCP SDK transports. Native Windows and interactive TUI acceptance should be reported separately from Linux tests.

No automatic debates, provider retries or whole-repository uploads. Features that change these boundaries need a concrete design and explicit user controls.
