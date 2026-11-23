import { createHash, randomUUID } from "node:crypto";
import type { Message } from "@oh-my-pi/pi-ai";
import type { Config } from "./config.ts";
import { selectedHistory, selectedMaterials } from "./context.ts";
import { BridgeError, publicError } from "./errors.ts";
import { validateHandoff } from "./handoff.ts";
import { discussionSystemPrompt, userPrompt } from "./prompts.ts";
import { type Request, requestSchema } from "./protocol.ts";
import type { Session, Store } from "./store.ts";
import type { Provider, Turn } from "./types.ts";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const sessionFingerprint = (config: Config) =>
  digest({ director: config.director, discussion: config.discussion });
export class Bridge {
  private active = new Map<string, AbortController>();
  constructor(
    private readonly config: Config,
    private readonly store: Store,
    private readonly provider: Provider,
  ) {}

  async dispatch(raw: unknown, signal?: AbortSignal): Promise<unknown> {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success)
      throw new BridgeError(
        "INVALID_REQUEST",
        "Invalid operation or arguments; consult needs prompt, and session operations need sessionId.",
      );
    const request = parsed.data;
    if (request.operation === "list") return { sessions: this.store.list() };
    if (request.operation === "new") {
      const now = new Date().toISOString();
      const session: Session = {
        id: randomUUID(),
        title: request.title ?? "New discussion",
        fingerprint: sessionFingerprint(this.config),
        status: "ready",
        messages: [],
        turns: [],
        totalTokens: 0,
        leaseUntil: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.store.put(session);
      return { sessionId: session.id, title: session.title, status: session.status };
    }
    if (request.operation !== "consult")
      return this.local(request.operation, request.sessionId as string, request.confirmationId);
    if (signal?.aborted)
      throw new BridgeError("CANCELLED", "Request was cancelled before dispatch.");
    const prepared = this.prepare(request);
    if ("cached" in prepared) return prepared.cached;
    return this.execute(request, prepared.session, prepared.messages, prepared.requestId, signal);
  }

  private prepare(request: Request) {
    const requestId = request.requestId ?? randomUUID();
    const requestDigest = digest({
      sessionId: request.sessionId ?? null,
      mode: request.mode,
      prompt: request.prompt,
      context: request.context ?? "",
      title: request.title ?? "",
      turnIds: request.turnIds,
      contextItemIds: request.contextItemIds,
    });
    const fingerprint = sessionFingerprint(this.config);
    return this.store.transaction(() => {
      const previous = this.store.request(requestId);
      if (previous) {
        if (previous.digest !== requestDigest)
          throw new BridgeError(
            "IDEMPOTENCY_CONFLICT",
            "This requestId belongs to different arguments.",
          );
        if (previous.status === "completed")
          return { cached: JSON.parse(previous.result as string) as unknown };
        throw new BridgeError(
          previous.status === "pending" ? "REQUEST_PENDING" : "REQUEST_FAILED",
          `Request already ${previous.status}; inspect the session. It will not be resubmitted.`,
        );
      }
      const now = new Date().toISOString();
      const session: Session = request.sessionId
        ? this.store.get(request.sessionId)
        : {
            id: randomUUID(),
            title: request.title ?? (request.prompt as string).slice(0, 80),
            fingerprint,
            status: "ready",
            messages: [],
            turns: [],
            totalTokens: 0,
            leaseUntil: 0,
            createdAt: now,
            updatedAt: now,
          };
      if (session.fingerprint !== fingerprint)
        throw new BridgeError(
          "CONFIG_CHANGED",
          "Collaborator model, role or task changed; start a new discussion to keep its provenance consistent.",
        );
      if (session.status !== "ready")
        throw new BridgeError(
          "SESSION_UNAVAILABLE",
          `Session is ${session.status}. Expired or interrupted requests need explicit recover before continuing.`,
        );
      if (session.turns.length >= this.config.limits.maxTurns)
        throw new BridgeError(
          "TURN_LIMIT",
          "Session turn limit reached; start a new focused session.",
        );
      const context = selectedMaterials(session, request, request.context);
      const content = userPrompt(request.mode, request.prompt as string, context);
      const messages: Message[] = [
        ...selectedHistory(session, request),
        { role: "user", content, timestamp: Date.now() },
      ];
      const input = JSON.stringify(messages) + discussionSystemPrompt(this.config);
      // UTF-8 bytes form a conservative upper bound for common byte-based tokenizers.
      const inputEstimate = Buffer.byteLength(input, "utf8");
      const reservation = inputEstimate + this.config.director.maxOutputTokens;
      if (
        input.length > this.config.limits.maxInputChars ||
        reservation > this.config.director.contextWindow
      )
        throw new BridgeError(
          "CONTEXT_LIMIT",
          "Context exceeds the configured bound. Select a smaller excerpt or start a new session; nothing was silently dropped.",
        );
      if (session.totalTokens + reservation > this.config.limits.maxSessionTokens)
        throw new BridgeError(
          "TOKEN_LIMIT",
          "Session token budget would be exceeded by the conservative request reservation.",
        );
      if (this.store.pendingCount() >= this.config.limits.maxConcurrent)
        throw new BridgeError(
          "BUSY",
          "Director concurrency limit reached. Retry later with the same requestId.",
        );
      session.status = "pending";
      session.pendingRequestId = requestId;
      session.leaseUntil = Date.now() + this.config.limits.timeoutMs + 30_000;
      this.store.put(session);
      this.store.reserve(requestId, session.id, requestDigest);
      return { session, messages, requestId };
    });
  }

  private async execute(
    request: Request,
    session: Session,
    messages: Message[],
    requestId: string,
    signal?: AbortSignal,
  ) {
    const controller = new AbortController();
    this.active.set(requestId, controller);
    const combined = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(this.config.limits.timeoutMs),
      ...(signal ? [signal] : []),
    ]);
    try {
      const completion = await this.provider.complete(messages, combined, session.id);
      combined.throwIfAborted();
      const turn: Turn = {
        requestId,
        mode: request.mode,
        prompt: request.prompt as string,
        text: completion.text,
        usage: completion.usage,
        truncated: completion.truncated,
        estimatedCostUsd: completion.estimatedCostUsd,
        collaborator: { model: this.config.director.model, api: this.config.director.api },
      };
      session.messages = [...session.messages, messages.at(-1) as Message, completion.message];
      session.turns.push(turn);
      session.totalTokens += completion.usage.totalTokens;
      session.status = "ready";
      delete session.pendingRequestId;
      session.leaseUntil = 0;
      const result = {
        sessionId: session.id,
        requestId,
        mode: request.mode,
        text: completion.text,
        usage: completion.usage,
        estimatedCostUsd: completion.estimatedCostUsd,
        truncated: completion.truncated,
        totalTokens: session.totalTokens,
        advisory: true,
        collaborator: { model: this.config.director.model, api: this.config.director.api },
        ...(request.mode === "brief" ? { handoff: validateHandoff(completion.text) } : {}),
      };
      this.store.transaction(() => {
        const current = this.store.get(session.id);
        if (current.status !== "pending" || current.pendingRequestId !== requestId)
          throw new BridgeError(
            "STALE_REQUEST",
            "Request ownership changed after recovery; the late result was not committed.",
          );
        this.store.put(session);
        this.store.finish(requestId, "completed", result);
      });
      return result;
    } catch (error) {
      session.status = "interrupted";
      session.leaseUntil = 0;
      delete session.pendingRequestId;
      const failure = combined.aborted
        ? new BridgeError(
            "CANCELLED",
            "Cancelled or timed out; the upstream outcome and billing may be unknown. No automatic resubmission.",
          )
        : error;
      this.store.transaction(() => {
        const current = this.store.get(session.id);
        if (current.status === "pending" && current.pendingRequestId === requestId) {
          this.store.put(session);
          this.store.finish(requestId, "failed", publicError(failure));
        }
      });
      const safe = publicError(failure);
      throw new BridgeError(
        safe.code,
        `${safe.message} Session: ${session.id}; request: ${requestId}.`,
      );
    } finally {
      this.active.delete(requestId);
    }
  }

  private local(operation: string, id: string, confirmationId?: string): unknown {
    return this.store.transaction(() => {
      const session = this.store.get(id);
      if (operation === "delete_preview") return this.store.previewDelete(id);
      if (operation === "delete") return this.store.deleteConfirmed(id, confirmationId as string);
      if (operation === "get" || operation === "read")
        return {
          sessionId: id,
          title: session.title,
          status: session.status,
          totalTokens: session.totalTokens,
          turns: session.turns,
          messages: session.messages,
          leaseUntil: session.leaseUntil,
          workspaceData: session.workspaceData,
        };
      if (operation === "export")
        return {
          sessionId: id,
          markdown: [
            `# ${session.title.replace(/[\r\n]/g, " ")}`,
            "Director output is advisory. Supplied context and stored guidance may be sensitive.",
            ...session.turns.map(
              (turn, i) => `## ${i + 1}. ${turn.mode}\n\n${turn.prompt}\n\n${turn.text}`,
            ),
          ].join("\n\n"),
        };
      if (session.status === "pending" && session.leaseUntil > Date.now())
        throw new BridgeError(
          "SESSION_BUSY",
          "A live request owns this session; cancel it or wait for its lease to expire.",
        );
      if (operation === "resume") {
        if (session.status === "interrupted" || session.status === "pending")
          throw new BridgeError(
            "RECOVERY_REQUIRED",
            "Explicitly recover the interrupted session before resuming.",
          );
        if (session.fingerprint !== sessionFingerprint(this.config))
          throw new BridgeError(
            "CONFIG_CHANGED",
            "Collaborator model, role or task changed; start a new discussion.",
          );
        session.status = "ready";
      } else if (operation === "recover") {
        if (!["pending", "interrupted"].includes(session.status))
          throw new BridgeError(
            "NOT_INTERRUPTED",
            "Only interrupted or expired pending sessions can be recovered.",
          );
        this.store.interruptRequests(id);
        session.status = "ready";
      } else session.status = "closed";
      session.leaseUntil = 0;
      delete session.pendingRequestId;
      this.store.put(session);
      return { sessionId: id, status: session.status, resubmitted: false };
    });
  }

  abort(): void {
    for (const controller of this.active.values()) controller.abort();
  }
  close(): void {
    if (this.active.size)
      throw new BridgeError("BUSY", "Cannot close storage while requests are active.");
    this.store.close();
  }
}
