import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { resolveCredential } from "./credentials.ts";
import { BridgeError } from "./errors.ts";
import { defaultConfigPath, defaultStorageDir } from "./paths.ts";

export const directorSchema = z
  .object({
    model: z.string().min(1).max(200),
    api: z.enum([
      "google-generative-ai",
      "openai-completions",
      "openai-responses",
      "anthropic-messages",
    ]),
    baseUrl: z.string().url(),
    apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    reasoning: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).default("high"),
    contextWindow: z.number().int().min(4096).max(2_000_000).default(1_000_000),
    maxOutputTokens: z.number().int().min(256).max(32_768).default(4096),
    // Prices are explicitly configured USD per million tokens, never inferred from an alias.
    pricing: z
      .object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cacheRead: z.number().nonnegative(),
        cacheWrite: z.number().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const url = new URL(value.baseUrl);
    if (url.username || url.password || url.search || url.hash)
      ctx.addIssue({
        code: "custom",
        message: "baseUrl must not contain credentials, query or fragment",
      });
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      ctx.addIssue({ code: "custom", message: "Use HTTPS, or HTTP on loopback only" });
    if (value.maxOutputTokens >= value.contextWindow)
      ctx.addIssue({ code: "custom", message: "Output must be smaller than context window" });
  });

export const configSchema = z
  .object({
    version: z.literal(1),
    director: directorSchema,
    discussion: z
      .object({
        role: z.string().trim().min(1).max(500).default("讨论伙伴"),
        taskInstructions: z.string().max(20_000).default(""),
      })
      .strict()
      .default({ role: "讨论伙伴", taskInstructions: "" }),
    profiles: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            label: z.string().trim().min(1).max(80),
            director: directorSchema,
          })
          .strict(),
      )
      .max(8)
      .default([]),
    presets: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            label: z.string().trim().min(1).max(80),
            role: z.string().trim().min(1).max(500),
            taskInstructions: z.string().max(20_000),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    storageDir: z.string().min(1).optional(),
    credentialsFile: z.string().min(1).optional(),
    limits: z
      .object({
        timeoutMs: z.number().int().min(1000).max(600_000).default(120_000),
        maxTurns: z.number().int().min(1).max(100).default(12),
        maxInputChars: z.number().int().min(1000).max(2_000_000).default(1_000_000),
        maxSessionTokens: z.number().int().min(1000).max(10_000_000).default(100_000),
        maxConcurrent: z.number().int().min(1).max(8).default(2),
      })
      .strict()
      .default({
        timeoutMs: 120_000,
        maxTurns: 12,
        maxInputChars: 1_000_000,
        maxSessionTokens: 100_000,
        maxConcurrent: 2,
      }),
  })
  .strict()
  .superRefine((config, ctx) => {
    const ids = config.profiles.map((p) => p.id);
    const keys = [config.director.apiKeyEnv, ...config.profiles.map((p) => p.director.apiKeyEnv)];
    if (new Set(ids).size !== ids.length || new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: "custom",
        path: ["profiles"],
        message: "Profile IDs and credential variable names must be unique",
      });
  });

export type Config = z.infer<typeof configSchema>;

export async function loadConfig(path?: string): Promise<Config & { storageDir: string }> {
  const configPath = resolve(path ?? defaultConfigPath());
  let raw: unknown;
  try {
    raw = JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    throw new BridgeError(
      "CONFIG_UNAVAILABLE",
      "Cannot read valid JSON configuration. Set GC_BRIDGE_CONFIG or use --config PATH.",
    );
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success)
    throw new BridgeError(
      "INVALID_CONFIG",
      `Invalid configuration fields: ${parsed.error.issues.map((i) => i.path.join(".") || "root").join(", ")}`,
    );
  return {
    ...parsed.data,
    credentialsFile: parsed.data.credentialsFile
      ? resolve(dirname(configPath), parsed.data.credentialsFile)
      : resolve(dirname(configPath), "credentials.json"),
    storageDir: parsed.data.storageDir
      ? resolve(dirname(configPath), parsed.data.storageDir)
      : defaultStorageDir(),
  };
}

export async function credentialPresent(config: Config): Promise<boolean> {
  return Boolean(await resolveCredential(config));
}
