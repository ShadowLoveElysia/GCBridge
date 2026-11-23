import type { Message } from "@oh-my-pi/pi-ai";
import type { modes } from "./protocol.ts";

export type Mode = (typeof modes)[number];
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}
export interface Completion {
  text: string;
  message: Message;
  usage: TokenUsage;
  truncated: boolean;
  estimatedCostUsd: number | null;
}
export interface Provider {
  complete(messages: Message[], signal: AbortSignal, sessionId: string): Promise<Completion>;
}
export interface Turn {
  requestId: string;
  mode: Mode;
  prompt: string;
  text: string;
  usage: TokenUsage;
  truncated: boolean;
  estimatedCostUsd: number | null;
  collaborator?: { model: string; api: string };
}
