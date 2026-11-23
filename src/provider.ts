import { completeSimple, Effort, type Message } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { Config } from "./config.ts";
import { resolveCredential } from "./credentials.ts";
import { BridgeError } from "./errors.ts";
import { discussionSystemPrompt } from "./prompts.ts";
import type { Provider } from "./types.ts";

export class OmpProvider implements Provider {
  constructor(private readonly config: Config) {}

  async complete(messages: Message[], signal: AbortSignal, sessionId: string) {
    const d = this.config.director;
    const apiKey = await resolveCredential(this.config);
    if (!apiKey?.trim())
      throw new BridgeError(
        "MISSING_CREDENTIAL",
        `Set the environment variable ${d.apiKeyEnv} before consulting the director.`,
      );
    const model = buildModel({
      id: d.model,
      name: d.model,
      api: d.api,
      provider: "gc-bridge-director",
      baseUrl: d.baseUrl.replace(/\/$/, ""),
      input: ["text"],
      reasoning: d.reasoning !== "off",
      contextWindow: d.contextWindow,
      maxTokens: d.maxOutputTokens,
      cost: d.pricing ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    let dispatched = false;
    let transportFailure: BridgeError | undefined;
    const response = await completeSimple(
      model,
      { systemPrompt: [discussionSystemPrompt(this.config)], messages },
      {
        apiKey,
        signal,
        sessionId,
        maxTokens: d.maxOutputTokens,
        ...(d.reasoning === "off"
          ? { disableReasoning: true }
          : {
              reasoning: {
                minimal: Effort.Minimal,
                low: Effort.Low,
                medium: Effort.Medium,
                high: Effort.High,
                xhigh: Effort.XHigh,
              }[d.reasoning],
            }),
        hideThinkingSummary: true,
        // Keep credentials at the configured origin, even if a gateway redirects.
        fetch: async (input, init) => {
          if (dispatched)
            throw new BridgeError(
              "REPLAY_BLOCKED",
              "Automatic provider replay is disabled; inspect the session before making a new request.",
            );
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (url.origin !== new URL(d.baseUrl).origin)
            throw new BridgeError(
              "ENDPOINT_CHANGED",
              "Provider attempted to use an unconfigured origin.",
            );
          dispatched = true;
          let response: Response;
          try {
            response = await fetch(input, { ...init, redirect: "error" });
          } catch {
            transportFailure = new BridgeError(
              "NETWORK_ERROR",
              "Cannot reach the configured director endpoint; check network, proxy and TLS trust.",
            );
            throw transportFailure;
          }
          // OMP can save rejected HTTP bodies as diagnostics. Keep errors outside
          // that path so selected project material never enters SDK request dumps.
          if (!response.ok) {
            await response.body?.cancel();
            transportFailure = new BridgeError(
              "PROVIDER_HTTP_ERROR",
              `Director returned HTTP ${response.status}.`,
            );
            throw transportFailure;
          }
          return response;
        },
      },
    );
    if (signal.aborted)
      throw new BridgeError(
        "CANCELLED",
        "Request cancelled or timed out; upstream billing may still apply.",
      );
    if (["error", "aborted"].includes(response.stopReason)) {
      if (transportFailure) throw transportFailure;
      throw new BridgeError(
        "PROVIDER_ERROR",
        "Director request failed; verify the model, protocol and credentials. Upstream outcome and billing may be unknown.",
      );
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text)
      throw new BridgeError(
        "EMPTY_RESPONSE",
        "Director returned no visible text. Check the reasoning and output budgets.",
      );
    const usage = {
      input: response.usage.input,
      output: response.usage.output,
      cacheRead: response.usage.cacheRead,
      cacheWrite: response.usage.cacheWrite,
      totalTokens: response.usage.totalTokens,
    };
    // Persist visible guidance only; discard provider reasoning and opaque metadata.
    const message: Message = {
      role: "assistant",
      content: [{ type: "text", text }],
      api: response.api,
      provider: response.provider,
      model: response.model,
      usage: response.usage,
      stopReason: response.stopReason,
      timestamp: Date.now(),
    };
    const estimatedCostUsd = d.pricing
      ? (usage.input * d.pricing.input +
          usage.output * d.pricing.output +
          usage.cacheRead * d.pricing.cacheRead +
          usage.cacheWrite * d.pricing.cacheWrite) /
        1_000_000
      : null;
    return { text, message, usage, estimatedCostUsd, truncated: response.stopReason === "length" };
  }
}
