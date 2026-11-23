import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createDependencyWorkspace,
  dependencyDirectory,
  externalBuildDirectory,
} from "./dependency-workspace.ts";

const root = resolve(import.meta.dir, ".."),
  target = process.argv[2] ?? `bun-${process.platform}-${process.arch}`;
const output = externalBuildDirectory(root);
const dependencies = dependencyDirectory(root);
const nativeTag = target
  .replace(/^bun-/, "")
  .replace(/-baseline$/, "")
  .replace(/^windows-/, "win32-");
const leaf = join(dependencies, "@oh-my-pi", `pi-natives-${nativeTag}`);
const files = (await readdir(leaf)).filter((f) => f.endsWith(".node"));
if (!files.length) throw new Error(`No Oh My Pi native addon for ${nativeTag}`);
await mkdir(output, { recursive: true });

const embedded = join(output, "embedded");
await mkdir(embedded, { recursive: true });
const appVersion = ((await Bun.file(join(root, "package.json")).json()) as { version: string })
  .version;
const manifest: { filename: string; variant: string; size: number; hash: string; path: string }[] =
  [];
for (const filename of files) {
  let nativePath = join(leaf, filename);
  if (nativeTag.startsWith("darwin-")) {
    nativePath = join(embedded, filename);
    await cp(join(leaf, filename), nativePath);
    execFileSync("codesign", ["--force", "--sign", "-", nativePath], { stdio: "inherit" });
  }
  const content = await readFile(nativePath),
    path = join(embedded, `${filename}.zst`);
  await writeFile(path, Bun.zstdCompressSync(content));
  manifest.push({
    filename,
    variant: filename.includes("-baseline")
      ? "baseline"
      : filename.includes("-modern")
        ? "modern"
        : "default",
    size: content.length,
    hash: createHash("sha256").update(content).digest("hex"),
    path,
  });
}
const names = [
  "ui/index.html",
  "ui/app.js",
  "ui/workspace.js",
  "ui/style.css",
  "examples/config.gemini.json",
  "skills/gc/SKILL.md",
];
const assets = Object.fromEntries(
  await Promise.all(names.map(async (name) => [name, await readFile(join(root, name), "utf8")])),
);
const file = join(output, target.includes("windows") ? "GCBridge.exe" : "GCBridge");
const workspace = await createDependencyWorkspace(root, dependencies);
let result: Awaited<ReturnType<typeof Bun.build>>;
try {
  result = await Bun.build({
    entrypoints: [join(workspace.root, "src/entry.ts")],
    target: "bun",
    minify: true,
    env: "disable",
    compile: {
      target: target as Bun.Build.CompileTarget,
      ...(process.env.GC_BRIDGE_COMPILE_RUNTIME
        ? { executablePath: process.env.GC_BRIDGE_COMPILE_RUNTIME }
        : {}),
      outfile: file,
      autoloadDotenv: false,
      autoloadBunfig: false,
      ...(target.includes("windows")
        ? {
            windows: {
              hideConsole: true,
              title: "GCBridge",
              version: `${appVersion}.0`,
              description: "Local model discussion workspace",
            },
          }
        : {}),
    },
    plugins: [
      {
        name: "gcbridge-embedded-assets",
        setup(build) {
          build.onLoad({ filter: /[/\\]assets\.ts$/ }, () => ({
            loader: "js",
            contents: `const assets=${JSON.stringify(assets)};export const assetNames=Object.keys(assets);export async function assetText(name){if(!(name in assets))throw Error("Unknown asset");return assets[name];}`,
          }));
          build.onLoad({ filter: /[/\\]pi-natives[/\\]native[/\\]embedded-addon\.js$/ }, () => ({
            loader: "js",
            contents:
              manifest
                .map(
                  (f, i) => `import frame${i} from ${JSON.stringify(f.path)} with {type:"file"};`,
                )
                .join("\n") +
              `\nexport const embeddedAddon={platformTag:${JSON.stringify(nativeTag)},version:"19.1.1",files:[${manifest.map((f, i) => `{filename:${JSON.stringify(f.filename)},variant:${JSON.stringify(f.variant)},size:${f.size},hash:${JSON.stringify(f.hash)},zstdPath:frame${i}}`).join(",")}]};`,
          }));
        },
      },
    ],
  });
} finally {
  await workspace.dispose();
}
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("Standalone build failed");
}
const binary = await readFile(file);
if (binary.length < 1_000_000) throw new Error("Compiled artifact is unexpectedly small");
await writeFile(
  join(output, "build-manifest.json"),
  `${JSON.stringify(
    {
      target,
      nativeTag,
      ompVersion: "19.1.1",
      nativeVariants: manifest.map(({ filename, hash, size }) => ({ filename, hash, size })),
      assets: names,
      byteLength: binary.length,
      testsInCI: false,
    },
    null,
    2,
  )}\n`,
);
const hash = createHash("sha256")
  .update(await readFile(file))
  .digest("hex");
await writeFile(join(output, "SHA256SUMS"), `${hash}  ${file.split(/[/\\]/).at(-1)}\n`);
await cp(join(root, "LICENSE"), join(output, "LICENSE"));
await cp(
  join(dependencies, "@oh-my-pi/pi-natives/THIRD-PARTY-NOTICES.txt"),
  join(output, "OMP-NATIVE-NOTICES.txt"),
);
await cp(join(root, "THIRD_PARTY_NOTICES.md"), join(output, "THIRD_PARTY_NOTICES.md"));
console.log(
  JSON.stringify({
    binary: file,
    target,
    nativeTag,
    embeddedNativeVariants: manifest.length,
    sha256: hash,
  }),
);
