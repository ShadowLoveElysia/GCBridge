import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const output = resolve(
  process.env.GC_BRIDGE_BUILD_DIR ??
    join(process.env.RUNNER_TEMP ?? process.env.TMPDIR ?? "/tmp", "gcbridge-build"),
);
const platform = process.platform,
  version = (
    (await Bun.file(resolve(import.meta.dir, "../package.json")).json()) as { version: string }
  ).version;
const xml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
if (platform === "darwin") {
  const contents = join(output, "GCBridge.app/Contents"),
    macos = join(contents, "MacOS");
  await mkdir(macos, { recursive: true });
  await copyFile(join(output, "GCBridge"), join(macos, "GCBridge"));
  await chmod(join(macos, "GCBridge"), 0o755);
  await writeFile(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>GCBridge</string><key>CFBundleDisplayName</key><string>GCBridge</string><key>CFBundleExecutable</key><string>GCBridge</string><key>CFBundleIdentifier</key><string>io.gcbridge.desktop</string><key>CFBundleVersion</key><string>${xml(version)}</string><key>CFBundleShortVersionString</key><string>${xml(version)}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`,
  );
  // Ad-hoc signing supports local launch; it is not Developer ID notarization.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", join(output, "GCBridge.app")], {
    stdio: "inherit",
  });
  execFileSync(
    "ditto",
    [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      join(output, "GCBridge.app"),
      join(output, `GCBridge-macos-${process.arch}.zip`),
    ],
    { stdio: "inherit" },
  );
} else if (platform === "linux") {
  // Archive executable mode; upload-artifact alone normalizes permissions.
  execFileSync(
    "tar",
    [
      "-czf",
      join(output, `GCBridge-linux-${process.arch}.tar.gz`),
      "-C",
      output,
      "GCBridge",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "OMP-NATIVE-NOTICES.txt",
    ],
    { stdio: "inherit" },
  );
}
const hashes: string[] = [];
for (const name of await readdir(output)) {
  if (name === "SHA256SUMS" || !(await stat(join(output, name))).isFile()) continue;
  hashes.push(
    `${createHash("sha256")
      .update(await readFile(join(output, name)))
      .digest("hex")}  ${name}`,
  );
}
await writeFile(join(output, "SHA256SUMS"), `${hashes.join("\n")}\n`);
