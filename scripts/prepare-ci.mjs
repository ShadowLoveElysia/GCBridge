import { appendFile, copyFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerTemp = process.env.RUNNER_TEMP;
const envFile = process.env.GITHUB_ENV;
const outputFile = process.env.GITHUB_OUTPUT;
if (!runnerTemp || !envFile || !outputFile) {
  throw new Error("RUNNER_TEMP, GITHUB_ENV and GITHUB_OUTPUT are required.");
}

const externalRoot = resolve(runnerTemp, "gcbridge");
const relativeRoot = relative(root, externalRoot);
if (!isAbsolute(relativeRoot) && relativeRoot !== ".." && !relativeRoot.startsWith(`..${sep}`)) {
  throw new Error("CI dependencies and output must be outside the checkout.");
}

const dependencies = join(externalRoot, "dependencies");
const cache = join(externalRoot, "cache");
const temporary = join(externalRoot, "tmp");
const artifacts = join(externalRoot, "output");
const directories = [
  dependencies,
  temporary,
  artifacts,
  join(cache, "npm"),
  join(cache, "bun"),
  join(cache, "node"),
  join(cache, "transpiler"),
];
await Promise.all(directories.map((path) => mkdir(path, { recursive: true })));
await Promise.all(
  ["package.json", "package-lock.json"].map((name) =>
    copyFile(join(root, name), join(dependencies, name)),
  ),
);

// runner context is unavailable in job-level env. Export native OS paths after allocation.
const environment = {
  GC_BRIDGE_DEPS_DIR: dependencies,
  NODE_PATH: join(dependencies, "node_modules"),
  npm_config_cache: join(cache, "npm"),
  BUN_INSTALL_CACHE_DIR: join(cache, "bun"),
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(cache, "transpiler"),
  NODE_COMPILE_CACHE: join(cache, "node"),
  GC_BRIDGE_BUILD_DIR: artifacts,
  TMPDIR: temporary,
  TEMP: temporary,
  TMP: temporary,
};
await appendFile(
  envFile,
  `${Object.entries(environment)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`,
  "utf8",
);
await appendFile(outputFile, `artifact_dir=${artifacts}\n`, "utf8");
console.log(`CI dependencies, cache and artifacts: ${externalRoot}`);
