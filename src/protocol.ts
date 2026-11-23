import { z } from "zod";

export const modes = ["explore", "brief", "review", "discuss"] as const;
export const requestSchema = z
  .object({
    operation: z
      .enum([
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
      ])
      .default("consult"),
    sessionId: z.string().uuid().optional(),
    requestId: z.string().uuid().optional(),
    mode: z.enum(modes).default("discuss"),
    prompt: z.string().min(1).max(1_000_000).optional(),
    context: z.string().max(1_000_000).optional(),
    title: z.string().min(1).max(120).optional(),
    confirmationId: z.string().uuid().optional(),
    turnIds: z.array(z.string().uuid()).max(100).optional(),
    contextItemIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.operation === "consult" && !value.prompt?.trim())
      ctx.addIssue({ code: "custom", path: ["prompt"], message: "A prompt is required" });
    if (!["consult", "list", "new"].includes(value.operation) && !value.sessionId)
      ctx.addIssue({ code: "custom", path: ["sessionId"], message: "A session ID is required" });
    if (value.operation === "delete" && !value.confirmationId)
      ctx.addIssue({
        code: "custom",
        path: ["confirmationId"],
        message: "Preview deletion and confirm the selected session first",
      });
  });
export type Request = z.infer<typeof requestSchema>;

export const toolDescription = `GC_Bridge: optional model discussion through headless Oh My Pi. Off by default; only explicit start launches it, without inference. consult modes: discuss(default), explore, brief, review. list/read/new/resume/export manage discussions. branch(sessionId,throughTurn,title) copies a selected prefix; original stays intact. workspace reads opinions, materials and snapshots. opinion_save records type/status/rationale/author/sourceRequestId; never invent adoption or user agreement. context_save stores explicitly provided material text. snapshot creates immutable stage; snapshot_read retrieves it. context_preview uses selected turnIds and contextItemIds and returns exact input; consult(previewId) sends it after user review. compare_preview with 1-4 profileIds presents independent targets and identical input; only explicit compare(previewId) may make those paid calls. No auto-synthesis or hidden retries. A changed discussion invalidates unsent previews. delete_preview then user confirmation then delete with confirmationId. recover acknowledges uncertain billing. Full replies stay in expandable tool output. Final report attributes issues, new perspectives and adoption decisions/reasons to source rounds. No auto-start, repository reads or coding assignment.`;
