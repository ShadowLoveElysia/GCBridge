import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { publicError } from "./errors.ts";
import { Manager } from "./manager.ts";
import { toolDescription } from "./protocol.ts";

/** Native OMP command adapter shares the same opt-in background as Codex. */
export default function extension(pi: ExtensionAPI): void {
  const z = pi.zod,
    manager = new Manager();
  pi.registerTool({
    name: "gc_bridge",
    label: "Collaborator",
    description: toolDescription,
    approval: "exec",
    parameters: z.object({
      operation: z.enum([
        "start",
        "status",
        "stop",
        "consult",
        "get",
        "read",
        "list",
        "close",
        "recover",
        "export",
        "new",
        "resume",
        "delete_preview",
        "delete",
        "branch",
        "workspace",
        "opinion_save",
        "context_save",
        "snapshot",
        "snapshot_read",
        "context_preview",
        "compare_preview",
        "compare",
      ]),
      workspace: z.string().optional(),
      sessionId: z.string().optional(),
      requestId: z.string().optional(),
      mode: z.enum(["explore", "brief", "review", "discuss"]).optional(),
      prompt: z.string().optional(),
      context: z.string().optional(),
      title: z.string().optional(),
      confirmationId: z.string().optional(),
      throughTurn: z.number().optional(),
      profileId: z.string().optional(),
      profileIds: z.array(z.string()).optional(),
      previewId: z.string().optional(),
      snapshotId: z.string().optional(),
      turnIds: z.array(z.string()).optional(),
      contextItemIds: z.array(z.string()).optional(),
      opinion: z
        .object({
          id: z.string().optional(),
          text: z.string(),
          kind: z.enum(["viewpoint", "consensus", "disagreement", "question"]),
          status: z.enum(["proposed", "adopted", "adjusted", "deferred", "rejected"]),
          rationale: z.string(),
          sourceRequestId: z.string().optional(),
          author: z.string(),
        })
        .optional(),
      material: z
        .object({ id: z.string().optional(), title: z.string(), text: z.string() })
        .optional(),
    }),
    async execute(_id, args, signal) {
      try {
        return {
          content: [
            { type: "text", text: JSON.stringify(await manager.dispatch(args, signal), null, 2) },
          ],
          details: { ok: true },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(publicError(error)) }],
          details: { ok: false },
        };
      }
    },
  });
  pi.registerCommand("gc", {
    description: "GC Bridge: start/status/stop/read/delete/new/resume/export or discuss a goal",
    async handler(args, ctx) {
      const [command, ...words] = args.trim().split(/\s+/);
      try {
        if (!command) {
          ctx.ui.notify(
            "/gc start | status | stop | read | delete | new | resume | export",
            "info",
          );
          return;
        }
        if (["start", "status", "stop", "new"].includes(command)) {
          ctx.ui.notify(
            JSON.stringify(await manager.dispatch({ operation: command, workspace: ctx.cwd })),
            "info",
          );
          return;
        }
        if (["read", "delete", "resume", "export"].includes(command)) {
          const data = (await manager.dispatch({ operation: "list" })) as {
            sessions: { id: string; title: string; turns: number }[];
          };
          if (!data.sessions.length) {
            ctx.ui.notify("No saved discussions.", "info");
            return;
          }
          const labels = data.sessions.map((s) => `${s.title} · ${s.turns} rounds · ${s.id}`);
          const choice = await ctx.ui.select("Select discussion", labels);
          if (!choice) return;
          const selected = data.sessions[labels.indexOf(choice)];
          if (!selected) return;
          let result: unknown;
          if (command === "delete") {
            const preview = (await manager.dispatch({
              operation: "delete_preview",
              sessionId: selected.id,
            })) as { confirmationId: string };
            if (
              !(await ctx.ui.confirm(
                "Delete discussion?",
                `Permanently delete ${selected.title} and all ${selected.turns} rounds?`,
              ))
            )
              return;
            result = await manager.dispatch({
              operation: "delete",
              sessionId: selected.id,
              confirmationId: preview.confirmationId,
            });
          } else
            result = await manager.dispatch({
              operation: command,
              workspace: ctx.cwd,
              sessionId: selected.id,
            });
          pi.sendMessage(
            {
              customType: "gc-bridge-history",
              content: JSON.stringify(result, null, 2),
              display: true,
            },
            { triggerTurn: false },
          );
          return;
        }
        const result = await manager.dispatch({
          operation: "consult",
          workspace: ctx.cwd,
          mode: "discuss",
          prompt: [command, ...words].join(" "),
        });
        pi.sendMessage(
          {
            customType: "gc-bridge-guidance",
            content: `Collaborator advisory result:\n${JSON.stringify(result, null, 2)}`,
            display: true,
          },
          { triggerTurn: true },
        );
      } catch (error) {
        ctx.ui.notify(publicError(error).message, "error");
      }
    },
  });
}
