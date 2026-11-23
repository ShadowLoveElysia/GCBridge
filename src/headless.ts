import { Agent, type AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage, Message } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { Config } from "./config.ts";
import { BridgeError } from "./errors.ts";
import { discussionSystemPrompt } from "./prompts.ts";
import { OmpProvider } from "./provider.ts";
import type { Completion, Provider } from "./types.ts";

/** Persistent, tool-free OMP Agent harness; SQLite remains the transcript authority. */
export class HeadlessOmp implements Provider {
  private agents = new Map<string, Agent>();
  private provider: OmpProvider;
  constructor(private readonly config: Config) {
    this.provider = new OmpProvider(config);
  }

  async complete(messages: Message[], signal: AbortSignal, sessionId: string): Promise<Completion> {
    const d = this.config.director;
    let completion: Completion | undefined;
    let failure: unknown;
    let calls = 0;
    const agent =
      this.agents.get(sessionId) ??
      new Agent({
        initialState: {
          systemPrompt: [discussionSystemPrompt(this.config)],
          tools: [],
          model: buildModel({
            id: d.model,
            name: d.model,
            api: d.api,
            provider: "gc-bridge-director",
            baseUrl: d.baseUrl,
            input: ["text"],
            reasoning: false,
            contextWindow: d.contextWindow,
            maxTokens: d.maxOutputTokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          }),
        },
      });
    this.agents.set(sessionId, agent);
    agent.replaceMessages(messages.slice(0, -1) as AgentMessage[]);
    agent.streamFn = async (_model, context) => {
      if (++calls > 1)
        throw new BridgeError(
          "REPLAY_BLOCKED",
          "The headless director cannot start an automatic model loop.",
        );
      const stream = new AssistantMessageEventStream();
      try {
        completion = await this.provider.complete(context.messages, signal, sessionId);
        const message = completion.message as AssistantMessage;
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: completion.truncated ? "length" : "stop", message });
      } catch (error) {
        failure = error;
        stream.fail(error);
      }
      return stream;
    };
    const abort = () => agent.abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      const last = messages.at(-1);
      if (!last) throw new BridgeError("EMPTY_REQUEST", "A director message is required.");
      await agent.prompt(last);
      if (failure) throw failure;
      if (!completion)
        throw new BridgeError(
          "DIRECTOR_FAILED",
          "Headless Oh My Pi returned no completed response.",
        );
      return completion;
    } finally {
      signal.removeEventListener("abort", abort);
      agent.replaceMessages([]);
      // Bound resident objects; history survives in SQLite when an idle agent is evicted.
      if (this.agents.size > 64) this.agents.delete(this.agents.keys().next().value as string);
    }
  }

  forget(id: string): void {
    this.agents.get(id)?.abort();
    this.agents.delete(id);
  }
}
