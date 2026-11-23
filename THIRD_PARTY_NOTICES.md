# Third-party notices

GC_Bridge uses Oh My Pi through published package dependencies. Source uses pinned published packages; compiled distributions embed the needed runtime modules/native components and retain upstream notices. GCBridge does not claim authorship of Oh My Pi.

- [Oh My Pi](https://github.com/can1357/oh-my-pi), `@oh-my-pi/pi-ai`, `pi-catalog`, `pi-coding-agent` and related dependencies, version 19.1.1. MIT. Copyright held by the upstream authors; upstream package metadata credits Stencil Labs, Inc. and Mario Zechner. The extension targets the published 19.1.1 interface.
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), `@modelcontextprotocol/sdk` 1.32.2. MIT.
- [Zod](https://github.com/colinhacks/zod), 4.3.6. MIT.
- [Bun](https://github.com/oven-sh/bun), runtime, MIT; bundled third-party components have their respective licenses.
- TypeScript and Biome are development tools with their upstream licenses.

Consult each installed package's LICENSE and the dependency lockfile for complete transitive dependencies and notices. Optional coding-agent development dependencies include additional third-party tools; the primary runtime uses the smaller pi-ai/provider surface. No model weights or proprietary model output corpus are included.

Compiled artifacts include `OMP-NATIVE-NOTICES.txt` from the pinned native package. Bun runtime and native add-ons are distributed under their respective licenses; the repository LICENSE applies to GCBridge code.
