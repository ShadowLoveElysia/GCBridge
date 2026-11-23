import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function dependencyDirectory(root: string): string {
  return resolve(
    process.env.NODE_PATH?.split(delimiter).find(Boolean) ??
      dirname(dirname(Bun.resolveSync("typescript/package.json", root))),
  );
}

function isWithin(root: string, path: string): boolean {
  const result = relative(root, path);
  return !isAbsolute(result) && result !== ".." && !result.startsWith(`..${sep}`);
}

/** Resolve package exports normally without placing dependencies in the checkout. */
export async function createDependencyWorkspace(root: string, dependencies: string) {
  const parent = dirname(dependencies);
  if (isWithin(root, parent)) {
    throw new Error("Build dependencies must be installed outside the checkout.");
  }
  if (!(await stat(dependencies)).isDirectory()) {
    throw new Error("External node_modules directory is missing; install dependencies first.");
  }
  const directory = await mkdtemp(join(parent, "gcbridge-source-"));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    for (const name of [
      "src",
      "scripts",
      "ui",
      "examples",
      "skills",
      "package.json",
      "tsconfig.json",
      "biome.json",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
    ]) {
      await cp(join(root, name), join(directory, name), { recursive: true });
    }
  } catch (error) {
    await dispose();
    throw error;
  }
  return { root: directory, dispose };
}

export function externalBuildDirectory(root: string): string {
  const directory = resolve(
    process.env.GC_BRIDGE_BUILD_DIR ??
      join(process.env.RUNNER_TEMP ?? process.env.TMPDIR ?? tmpdir(), "gcbridge-build"),
  );
  if (isWithin(root, directory)) {
    throw new Error("Build artifacts must be written outside the checkout.");
  }
  return directory;
}
