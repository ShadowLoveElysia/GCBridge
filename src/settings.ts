import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { assetText } from "./assets.ts";
import { configSchema, credentialPresent, loadConfig } from "./config.ts";
import { BridgeError } from "./errors.ts";
import { Manager } from "./manager.ts";
import { defaultConfigPath } from "./paths.ts";
import { writePrivate } from "./private-files.ts";

export async function ensureSettings(path = defaultConfigPath()): Promise<string> {
  try {
    await readFile(path);
    return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const raw: unknown = JSON.parse(await assetText("examples/config.gemini.json"));
  const config = configSchema.parse(raw);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writePrivate(path, config);
  return path;
}

export async function safeSettings(path: string) {
  const config = await loadConfig(path);
  return {
    config: {
      version: config.version,
      director: config.director,
      discussion: config.discussion,
      limits: config.limits,
      profiles: config.profiles,
      presets: config.presets,
    },
    credentialPresent: await credentialPresent(config),
    profileCredentialPresent: Object.fromEntries(
      await Promise.all(
        config.profiles.map(async (p) => [
          p.id,
          await credentialPresent({ ...config, director: p.director }),
        ]),
      ),
    ),
    configPath: path,
    storageDir: config.storageDir,
  };
}

const saveSchema = z
  .object({
    config: configSchema,
    secret: z.string().max(8192).optional(),
    clearSecret: z.boolean().default(false),
    profileSecrets: z.record(z.string().uuid(), z.string().max(8192)).optional(),
  })
  .strict();
export async function saveSettings(path: string, raw: unknown) {
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success)
    throw new BridgeError(
      "INVALID_CONFIG",
      "Check the model, protocol, URL and numeric limits; no fields were saved.",
    );
  if (((await new Manager(path).status()) as { running: boolean }).running)
    throw new BridgeError("STOP_REQUIRED", "Stop Bridge before saving a different configuration.");
  const previous = await loadConfig(path);
  const next = parsed.data.config;
  const supplied = parsed.data.secret?.trim();
  if (
    (next.director.baseUrl !== previous.director.baseUrl ||
      next.director.apiKeyEnv !== previous.director.apiKeyEnv) &&
    !supplied &&
    !parsed.data.clearSecret &&
    (await credentialPresent(previous))
  )
    throw new BridgeError(
      "NEW_ENDPOINT_CREDENTIAL",
      "When changing the API address, provide a key for that endpoint or explicitly clear the stored key.",
    );
  const credentialPath = resolve(dirname(path), "credentials.json");
  let credentials: { directorApiKey?: string; keys?: Record<string, string> } = {};
  try {
    credentials = JSON.parse(await readFile(credentialPath, "utf8")) as typeof credentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const keys = { ...credentials.keys };
  if (credentials.directorApiKey && !keys[previous.director.apiKeyEnv])
    keys[previous.director.apiKeyEnv] = credentials.directorApiKey;
  for (const profile of next.profiles) {
    const old = previous.profiles.find((p) => p.id === profile.id),
      secret = parsed.data.profileSecrets?.[profile.id]?.trim();
    const previousOwner = previous.profiles.find(
      (p) => p.director.apiKeyEnv === profile.director.apiKeyEnv,
    );
    if (
      !old &&
      !secret &&
      keys[profile.director.apiKeyEnv] &&
      previousOwner?.director.baseUrl !== profile.director.baseUrl
    )
      throw new BridgeError(
        "NEW_ENDPOINT_CREDENTIAL",
        "New profile cannot reuse a different endpoint's saved key.",
      );
    if (
      old &&
      (old.director.baseUrl !== profile.director.baseUrl ||
        old.director.apiKeyEnv !== profile.director.apiKeyEnv) &&
      !secret &&
      keys[old.director.apiKeyEnv]
    )
      throw new BridgeError(
        "NEW_ENDPOINT_CREDENTIAL",
        "Changed model profiles need a key for their new address.",
      );
    if (secret) keys[profile.director.apiKeyEnv] = secret;
  }
  if (supplied || parsed.data.clearSecret) keys[next.director.apiKeyEnv] = supplied ?? "";
  const keep = new Set([
    next.director.apiKeyEnv,
    ...next.profiles.map((p) => p.director.apiKeyEnv),
  ]);
  await writePrivate(credentialPath, {
    keys: Object.fromEntries(Object.entries(keys).filter(([k]) => keep.has(k))),
  });
  await writePrivate(path, {
    ...next,
    credentialsFile: credentialPath,
    storageDir: previous.storageDir,
  });
  return safeSettings(path);
}
