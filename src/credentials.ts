import { readFile, stat } from "node:fs/promises";
import type { Config } from "./config.ts";
import { BridgeError } from "./errors.ts";

/** Credentials stay in a private user file, independent of the distributable config. */
export async function resolveCredential(config: Config): Promise<string | undefined> {
  const environment = process.env[config.director.apiKeyEnv]?.trim();
  if (environment) return environment;
  if (!config.credentialsFile) return undefined;
  try {
    const info = await stat(config.credentialsFile);
    if (!info.isFile() || (process.platform !== "win32" && (info.mode & 0o077) !== 0))
      throw new BridgeError(
        "CREDENTIAL_PERMISSIONS",
        "Private credential file must be readable only by its owner (chmod 600).",
      );
    const raw: unknown = JSON.parse(
      (await readFile(config.credentialsFile, "utf8")).replace(/^\uFEFF/, ""),
    );
    if (
      raw &&
      typeof raw === "object" &&
      "keys" in raw &&
      raw.keys &&
      typeof raw.keys === "object"
    ) {
      const key = Reflect.get(raw.keys, config.director.apiKeyEnv);
      if (typeof key === "string") return key.trim() || undefined;
      return undefined;
    }
    if (
      raw &&
      typeof raw === "object" &&
      "directorApiKey" in raw &&
      typeof raw.directorApiKey === "string"
    )
      return config.profiles.some((p) => p.director.apiKeyEnv === config.director.apiKeyEnv)
        ? undefined
        : raw.directorApiKey.trim() || undefined;
    throw new BridgeError(
      "INVALID_CREDENTIAL_FILE",
      "Private credential file has an invalid format.",
    );
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new BridgeError(
      "CREDENTIAL_UNAVAILABLE",
      "Cannot read private credentials; run setup again.",
    );
  }
}
