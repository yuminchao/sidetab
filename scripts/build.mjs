import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

export async function copyRequiredIcons(projectRoot, distRoot) {
  await mkdir(resolve(distRoot, "assets"), { recursive: true });
  await cp(resolve(projectRoot, "assets/icons"), resolve(distRoot, "assets/icons"), {
    recursive: true,
  });
}

async function buildExtension(projectRoot) {
  const root = resolve(projectRoot);
  const dist = resolve(root, "dist");

  await rm(dist, { recursive: true, force: true });
  await mkdir(resolve(dist, "background"), { recursive: true });
  await mkdir(resolve(dist, "sidepanel"), { recursive: true });
  await copyRequiredIcons(root, dist);

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

  await cp(resolve(root, "src/sidepanel/sidebar.css"), resolve(dist, "sidepanel/sidebar.css"));
  await cp(resolve(root, "src/sidepanel/index.html"), resolve(dist, "sidepanel/index.html"));
  await cp(resolve(root, "THIRD_PARTY_NOTICES.md"), resolve(dist, "THIRD_PARTY_NOTICES.md"));

  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  await writeFile(resolve(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function isMain(moduleUrl) {
  return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === moduleUrl;
}

if (isMain(import.meta.url)) {
  await buildExtension(resolve(import.meta.dirname, ".."));
}
