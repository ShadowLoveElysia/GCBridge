import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectRoot } from "./paths.ts";

export const assetNames = [
  "ui/index.html",
  "ui/app.js",
  "ui/workspace.js",
  "ui/style.css",
  "examples/config.gemini.json",
  "skills/gc/SKILL.md",
] as const;
export async function assetText(name: string): Promise<string> {
  if (!(assetNames as readonly string[]).includes(name)) throw new Error("Unknown bundled asset");
  return readFile(join(projectRoot, name), "utf8");
}
