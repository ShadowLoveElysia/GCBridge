import { z } from "zod";
import { requestSchema } from "./protocol.ts";

export const controlSchema = z
  .object({
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
    workspace: z.string().min(1).max(4096).optional(),
    sessionId: z.string().uuid().optional(),
    requestId: z.string().uuid().optional(),
    mode: z.enum(["explore", "brief", "review", "discuss"]).optional(),
    prompt: z.string().min(1).max(1_000_000).optional(),
    context: z.string().max(1_000_000).optional(),
    title: z.string().min(1).max(120).optional(),
    confirmationId: z.string().uuid().optional(),
    throughTurn: z.number().int().min(0).max(100).optional(),
    profileId: z.string().uuid().optional(),
    profileIds: z.array(z.string().uuid()).min(1).max(4).optional(),
    previewId: z.string().uuid().optional(),
    snapshotId: z.string().uuid().optional(),
    turnIds: z.array(z.string().uuid()).max(100).optional(),
    contextItemIds: z.array(z.string().uuid()).max(100).optional(),
    opinion: z
      .object({
        id: z.string().uuid().optional(),
        text: z.string().trim().min(1).max(20_000),
        kind: z.enum(["viewpoint", "consensus", "disagreement", "question"]),
        status: z.enum(["proposed", "adopted", "adjusted", "deferred", "rejected"]),
        rationale: z.string().max(20_000),
        sourceRequestId: z.string().uuid().optional(),
        author: z.string().trim().min(1).max(200),
      })
      .strict()
      .optional(),
    material: z
      .object({
        id: z.string().uuid().optional(),
        title: z.string().trim().min(1).max(120),
        text: z.string().max(200_000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (
      ["branch", "workspace", "opinion_save", "context_save", "snapshot", "snapshot_read"].includes(
        request.operation,
      ) &&
      !request.sessionId
    )
      ctx.addIssue({ code: "custom", path: ["sessionId"], message: "Select a discussion" });
    if (
      ["context_preview", "compare_preview"].includes(request.operation) &&
      !request.prompt?.trim()
    )
      ctx.addIssue({ code: "custom", path: ["prompt"], message: "A question is required" });
    if (request.operation === "compare_preview" && !request.profileIds?.length)
      ctx.addIssue({
        code: "custom",
        path: ["profileIds"],
        message: "Choose target model profiles",
      });
    if (request.operation === "compare" && !request.previewId)
      ctx.addIssue({ code: "custom", path: ["previewId"], message: "Preview before sending" });
  });
export type ControlRequest = z.infer<typeof controlSchema>;
export function toBridgeRequest(request: ControlRequest) {
  const { workspace: _, profileId: _profile, ...payload } = request;
  return requestSchema.parse(payload);
}
