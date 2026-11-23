# Security and private data

Keep actual API keys outside the repository. `director.apiKeyEnv` names an environment variable; it does not contain the secret. Unknown configuration fields are rejected, including `apiKey`. URLs with credentials, query strings or fragments are rejected. Cleartext HTTP is allowed only on loopback.

Do not put keys in MCP JSON/TOML `env` literals, config examples, scripts or command history. Use an OS secret manager or a password prompt that sets only the launching process environment. The GUI persists the key only in the private user credentials.json (owner-only permissions); public config contains only its path. The GUI never returns key content. It does not read Codex/OMP credential stores. `doctor` reports only credential presence.

The credential is sent to the **explicitly configured API origin**. Redirects and alternate origins are blocked. Selecting a third-party base URL means entrusting it with the key, prompt and selected context. No background discovery or telemetry is enabled by GC_Bridge.

`context` is explicit. No repository files or earlier host messages are automatically uploaded. The director has no filesystem or shell tools. Its output is untrusted advisory text and does not change host permissions. Prompt instructions reduce mistakes but do not make model content trustworthy.

Local SQLite history contains prompts, selected context and guidance in plaintext. It defaults to a user data directory outside the checkout. On Unix the directory is created with mode 0700 and database with 0600; on Windows use a private directory with appropriate ACLs. `close` does not delete history. Stop all bridge processes before manually removing private storage. Do not publish databases, exports or personal configurations.

Public errors do not forward raw SDK exceptions or response bodies. Non-success HTTP responses are converted before upstream diagnostic handling, preventing rejected-request dumps containing selected context. Model-visible text is returned to the caller and persisted as requested; never include secrets in prompts.

Before publishing, stage only reviewed source/docs/examples, then run `bun src/release-check.ts`. It scans **tracked** files, rejects suspicious key assignments and private artifacts, and never prints matching secret values. This is a heuristic check, not proof that arbitrary user data is public. The package also uses a publication allowlist and `private: true` to prevent accidental npm publication.

No `.gitignore` is created or changed by this task. Local Git exclusions belong to `.git/info/exclude`; public files are staged explicitly. CI runs the same tracked-file check. Do not use `git add .` without reviewing untracked files.

For a vulnerability report, avoid placing secrets in a public issue. A private reporting channel must be configured by the future repository maintainer before public release.


The optional GUI binds a random loopback port and authenticates API requests with a per-process capability in the initial URL fragment. The fragment is removed from browser history immediately and used only in memory. APIs reject missing credentials and foreign Origins, set no-store and a restrictive CSP. The private daemon has a distinct random token in owner-only state, rejects browser Origin, and cannot be started by an ordinary consult. Closing Codex MCP does not stop a deliberately shared background; use stop. A changed endpoint requires a new credential or explicit clearing.

Conversation deletion is a two-step operation: a five-minute preview confirmation is bound to the exact selected session and content fingerprint. A session change invalidates it. GUI/skill must obtain human confirmation; a token is not proof of a human click for an arbitrary third-party caller. SQLite logical deletion does not promise forensic secure erasure of WAL/backups or provider-side data.

Tests and all generated runtime artifacts stay outside the repository. The tracked-file release check rejects test directories and test source filenames as well as credentials and private databases. GitHub CI performs static checks only.


Standalone builds embed platform-native code and release it only into the current user's cache through the upstream version/hash loader. Unsigned Windows builds and non-notarized macOS builds can trigger OS protections; no feature disables antivirus or Gatekeeper. The GUI never changes unrelated Codex providers, detection never injects automatically, and shared CLI/Desktop config changes are labeled. Tests remain local and external; Actions only compile/check and upload program artifacts.
