import { join } from "node:path";
import { platformDirectories } from "./paths.ts";

// Set a private extraction/cache location before OMP imports load native components.
process.env.PI_NATIVES_DIR ??= join(platformDirectories().cache, "oh-my-pi", "natives");
try {
  await import("./cli.ts");
} catch {
  console.error(
    "GCBridge could not load its bundled Oh My Pi components. Download the build matching this OS/CPU and verify the user cache is writable.",
  );
  process.exitCode = 1;
}
