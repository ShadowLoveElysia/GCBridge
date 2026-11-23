#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { credentialPresent, loadConfig } from "./config.ts";
import { BridgeError, publicError } from "./errors.ts";
import { Manager } from "./manager.ts";
import { startMcp } from "./mcp.ts";
import { compiled } from "./paths.ts";
import { ensureSettings } from "./settings.ts";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      config: { type: "string" },
      target: { type: "string" },
      "codex-home": { type: "string" },
      mode: { type: "string" },
      session: { type: "string" },
      "request-id": { type: "string" },
      context: { type: "string" },
      workspace: { type: "string" },
      title: { type: "string" },
      confirmation: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command = compiled ? "gui" : "help", ...words] = positionals;
  if (command === "daemon") {
    const { runDaemon } = await import("./daemon.ts");
    await runDaemon(await ensureSettings(values.config));
    return;
  }
  if (command === "components") {
    const { componentStatus } = await import("./components.ts");
    console.log(JSON.stringify(await componentStatus(), null, 2));
    return;
  }
  if (values.help || command === "help") {
    console.log(`GC_Bridge 0.3 — on-demand headless Oh My Pi collaboration

gui                         Open local configuration and conversation manager
start | status | stop        Explicit lifecycle control (no inference on start)
mcp                         Lightweight Codex adapter; director stays off
consult "GOAL"               --mode explore|brief|review|discuss
list | read UUID | export UUID
new [--title TITLE] | resume UUID | close UUID | recover UUID
delete_preview UUID          Preview exact deletion scope
delete UUID --confirmation UUID  Only after user confirms preview
doctor                       Offline configuration/credential check
install-codex                Register CLI/Desktop skill and MCP entries
request                     Read a complete operation JSON from stdin (all workspace actions)

Options: --config PATH --workspace PATH --session UUID --request-id UUID
Private config: ~/.config/gc-bridge/config.json; secrets in credentials.json.
Bridge is disabled until start. Collaborator guidance is advisory.`);
    return;
  }
  if (command === "detect-codex") {
    const { detectCodex } = await import("./codex-detection.ts");
    console.log(JSON.stringify(await detectCodex(), null, 2));
    return;
  }
  if (command === "doctor") {
    const c = await loadConfig(values.config);
    console.log(
      JSON.stringify(
        {
          ok: true,
          runtime: Bun.version,
          model: c.director.model,
          api: c.director.api,
          credentialPresent: await credentialPresent(c),
          networkTested: false,
          storageDir: c.storageDir,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "gui") {
    const { startGui } = await import("./gui.ts");
    await startGui(values.config);
    return;
  }
  if (command === "install-codex") {
    const { installCodex } = await import("./install.ts");
    console.log(
      JSON.stringify(
        await installCodex(
          values.target ? { targetId: values.target, configRoot: values["codex-home"] } : undefined,
        ),
        null,
        2,
      ),
    );
    return;
  }
  const manager = new Manager(values.config);
  if (command === "request") {
    const input = await Bun.stdin.text();
    if (input.length > 3_000_000)
      throw new BridgeError("REQUEST_LIMIT", "Structured request exceeds input limit.");
    let payload: unknown;
    try {
      payload = JSON.parse(input);
    } catch {
      throw new BridgeError("INVALID_REQUEST", "Pass one JSON request on stdin.");
    }
    console.log(JSON.stringify(await manager.dispatch(payload), null, 2));
    return;
  }
  if (command === "mcp") {
    const server = await startMcp(manager);
    const stop = () => {
      void server.close();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return;
  }
  if (
    ![
      "start",
      "status",
      "stop",
      "consult",
      "list",
      "read",
      "get",
      "export",
      "new",
      "resume",
      "close",
      "recover",
      "delete_preview",
      "delete",
    ].includes(command)
  )
    throw new BridgeError("INVALID_COMMAND", "Unknown command. Use --help.");
  const result = await manager.dispatch({
    operation: command,
    workspace: values.workspace ?? process.cwd(),
    sessionId: values.session ?? (command !== "consult" ? words[0] : undefined),
    requestId: values["request-id"],
    mode: values.mode,
    prompt: command === "consult" ? words.join(" ") : undefined,
    context: values.context,
    title: values.title,
    confirmationId: values.confirmation,
  });
  console.log(
    command === "export" && !values.json
      ? (result as { markdown: string }).markdown
      : JSON.stringify(result, null, 2),
  );
}
main().catch((error) => {
  console.error(JSON.stringify(publicError(error)));
  process.exitCode = 1;
});
