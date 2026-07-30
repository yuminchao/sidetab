import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const ITERATIONS = 30;

async function loadRenderer() {
  const result = await build({
    entryPoints: [resolve(import.meta.dirname, "../src/sidepanel/tab-renderer.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome114",
    write: false,
  });
  const source = result.outputFiles[0]?.text;
  if (!source) throw new Error("tab renderer benchmark bundle is empty");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(moduleUrl);
}

function createItems(count) {
  return Array.from({ length: count }, (_, index) => ({
    kind: "tab",
    tab: {
      id: index + 1,
      windowId: 1,
      index,
      title: `Tab ${index + 1}`,
      url: `https://site-${index + 1}.example/path`,
      domain: `site-${index + 1}.example`,
      active: index === 0,
      pinned: false,
      groupId: -1,
    },
  }));
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function round(value) {
  return Number(value.toFixed(3));
}

async function benchmark(createTabRenderer, count) {
  const dom = new JSDOM('<main><div id="list"></div><p id="empty"></p></main>');
  const previousGlobals = new Map();
  for (const name of ["document", "Element", "HTMLElement", "HTMLImageElement"]) {
    previousGlobals.set(name, globalThis[name]);
    globalThis[name] = dom.window[name];
  }

  try {
    const list = dom.window.document.querySelector("#list");
    const empty = dom.window.document.querySelector("#empty");
    const renderer = createTabRenderer({ list, empty });
    let items = createItems(count);
    renderer.render(items);

    for (let index = 0; index < 5; index += 1) {
      items = [items.at(-1), ...items.slice(0, -1)];
      renderer.render(items);
    }

    const timings = [];
    for (let index = 0; index < ITERATIONS; index += 1) {
      items = index % 2 === 0
        ? [items.at(-1), ...items.slice(0, -1)]
        : [...items.slice(1), items[0]];
      const start = performance.now();
      renderer.render(items);
      timings.push(performance.now() - start);
    }
    timings.sort((left, right) => left - right);

    const metric = {
      count,
      medianMs: round(percentile(timings, 0.5)),
      p95Ms: round(percentile(timings, 0.95)),
      domNodes: list.querySelectorAll("*").length,
      heapUsedMb: round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
    renderer.destroy();
    return metric;
  } finally {
    for (const [name, value] of previousGlobals) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
    dom.window.close();
  }
}

const { createTabRenderer } = await loadRenderer();
for (const count of [100, 500]) {
  console.log(JSON.stringify(await benchmark(createTabRenderer, count)));
}
