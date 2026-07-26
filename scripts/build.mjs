import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "background"), { recursive: true });
await mkdir(resolve(dist, "sidepanel"), { recursive: true });
await mkdir(resolve(dist, "assets"), { recursive: true });

await build({
  entryPoints: {
    "background/service-worker": resolve(root, "src/background/service-worker.ts"),
    "sidepanel/sidebar": resolve(root, "src/sidepanel/sidebar.ts"),
  },
  bundle: true,
  format: "esm",
  target: "chrome114",
  minify: true,
  outdir: dist,
  sourcemap: false,
});

try {
  await cp(resolve(root, "assets/icons"), resolve(dist, "assets/icons"), { recursive: true });
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
    throw error;
  }
}

await cp(resolve(root, "src/sidepanel/sidebar.css"), resolve(dist, "sidepanel/sidebar.css"));
await cp(resolve(root, "src/sidepanel/index.html"), resolve(dist, "sidepanel/index.html"));
await cp(resolve(root, "THIRD_PARTY_NOTICES.md"), resolve(dist, "THIRD_PARTY_NOTICES.md"));

const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
await writeFile(resolve(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
