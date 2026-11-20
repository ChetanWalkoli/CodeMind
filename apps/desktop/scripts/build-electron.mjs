import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");

async function buildElectron() {
  const sharedConfig = {
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    sourcemap: true,
    external: ["electron"],
    logLevel: "info"
  };

  await Promise.all([
    build({
      ...sharedConfig,
      entryPoints: [path.join(desktopRoot, "electron/main.ts")],
      outfile: path.join(desktopRoot, "dist-electron/main.cjs")
    }),
    build({
      ...sharedConfig,
      entryPoints: [path.join(desktopRoot, "electron/preload.ts")],
      outfile: path.join(desktopRoot, "dist-electron/preload.cjs")
    })
  ]);
}

buildElectron().catch((error) => {
  console.error("Failed to build Electron main/preload bundles:", error);
  process.exit(1);
});
