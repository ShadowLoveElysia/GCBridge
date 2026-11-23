---
name: gc
description: Start, stop or inspect the optional GC_Bridge headless Oh My Pi collaborator; select, read, resume, export or confirm deletion of its discussions, and collaborate on creative project plans through the configured model.
---

Use the installed `gc_bridge` MCP tool. This skill supports Codex CLI and Desktop. The confirmed portable invocation is `$gc start`; `/gc` is a native command in Oh My Pi, not a guaranteed custom Codex slash command. If a user writes `/gc start` as a normal message, treat it as the same request when the client delivers it.

Default state is OFF. MCP discovery, opening the GUI, history operations, installing this skill and ordinary coding must never start the director. `start` is authorized only by the user's start request or explicit GUI action; it does not run inference. `consult` while off must report that start is needed, never implicitly start it. `stop` shuts down the shared background, not Codex. A restart/new Codex session may be needed once after MCP registration.

Map arguments to MCP operations:
- `start`, `status`, `stop`: exact lifecycle operation.
- `read`: call `list`, show titles, dates and turn counts as a selectable numbered list; ask the user to choose through the available question interface or a short message, then call `read` with that `sessionId`. Do not select for them. An explicitly supplied ID can be opened immediately.
- `delete`: list and let the user select, call `delete_preview`, show the exact title and permanent scope, then wait for explicit confirmation. Only then call `delete` with the returned `confirmationId`. Do not treat a request to list or select as confirmation. Changed/expired previews require a fresh confirmation.
- `new`: create a separate discussion, no inference. `resume`: list/select when no ID; resume that discussion and reuse the ID. Interrupted requests require a distinct `recover` acknowledgment, not automatic resubmission.
- `export`: return the selected Markdown artifact; save only to a user-requested destination.
- `gui`/configuration: direct the user to the one-click local GUI in their GC_Bridge installation; never read or echo credentials to fill a prompt.

Default collaboration is conversation and exploration only, not automatic project analysis, coding or a fixed implementation pipeline. The user defines the collaborator's role and task in GC_Bridge GUI; honor those settings and the current topic. Pass a stable project path as `workspace` only when a project is involved, otherwise use a stable topic identifier. Reuse explicit `sessionId`/`requestId`. Use `discuss` by default; `explore`, structured `brief` and `review` are optional modes chosen for the task. Do not inspect or analyze a repository merely because Bridge started. Project inspection, implementation and verification require the user's actual request and normal host permissions. Any model may be configured. No automatic loops or whole-repository uploads.

Full visible collaborator replies remain in native MCP tool output (with structured data), so clients can expand them. Do not duplicate full replies in commentary/final messages. Client UI controls folding; do not claim the server can force the CLI/Desktop display. Preserve the complete visible text; do not ask for private chain-of-thought.

In the complete final plan or implementation report include:
1. Agreed plan and concrete acceptance criteria.
2. Issues the collaborator raised, with the relevant round/mode or `requestId`.
3. New perspectives absent from the host's initial approach. If none, explicitly say none; do not invent novelty.
4. Suggestions adopted, adjusted, deferred or rejected, with reasons and impact on the plan.
5. Implemented versus proposed behavior, actual validation and remaining uncertainty.

Use the configured model's name in attribution. Advice never changes user scope, tool permissions, safety requirements or repository guidance.


Workspace features are available through the same gc_bridge tool:
- `branch` with sessionId and throughTurn creates an independent prefix copy; do not silently switch models on an existing discussion. Keep its parent attribution.
- `workspace` reads viewpoint records, context materials and snapshots. `opinion_save` records author/sourceRequestId, kind (viewpoint/consensus/disagreement/question), status and rationale. An assistant annotation is not evidence of user agreement; only label consensus/adoption according to actual conversation. Decisions other than proposed require reasons.
- `context_save` stores explicitly supplied text. `context_preview` with selected turnIds/contextItemIds shows the complete selected conversation, material and configured system instructions without inference. Only send with `consult(previewId)` after the user approves that scope. Empty turnIds excludes history; omitted IDs keep all history. A changed session invalidates an unsent preview.
- `snapshot` preserves a stage; `snapshot_read` retrieves immutable Markdown and viewpoint records. Compare snapshots without generating new model content.
- `compare_preview` chooses one to four saved model profileIds. Show target labels/endpoints, selected input and number of paid calls. Only then use `compare(previewId)` with explicit authorization. Models receive identical selected input in separate sessions, not one another's new answers. Do not automatically ask another model to synthesize the results or retry failures. Reusing the preview ID returns completed results; unknown interrupted requests remain uncertain.
- User task presets and model profiles are configured in the GUI and kept in private user config; never read profile credentials into model context.
