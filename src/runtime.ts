import { Bridge } from "./bridge.ts";
import { loadConfig } from "./config.ts";
import { OmpProvider } from "./provider.ts";
import { Store } from "./store.ts";

export async function createBridge(configPath?: string): Promise<Bridge> {
  const config = await loadConfig(configPath);
  return new Bridge(config, new Store(config.storageDir), new OmpProvider(config));
}
