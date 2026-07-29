import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pngAssets = [
  ["assets/icons/icon-16.png", 16],
  ["assets/icons/icon-32.png", 32],
  ["assets/icons/icon-48.png", 48],
  ["assets/icons/icon-128.png", 128],
  ["assets/shortcuts/openai.png", 32],
  ["assets/shortcuts/google.png", 32],
  ["assets/shortcuts/github.png", 32],
] as const;

describe("local image assets", () => {
  it.each(pngAssets)("provides %s as a non-empty %i px PNG", async (path, size) => {
    const image = sharp(path);
    const [metadata, contents] = await Promise.all([image.metadata(), image.toBuffer()]);

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(size);
    expect(metadata.height).toBe(size);
    expect(contents.byteLength).toBeGreaterThan(0);
  });

  it.each(["search.svg", "settings.svg"])(
    "provides a sanitized %s mask asset",
    (name) => {
      const assetPath = `assets/icons/${name}`;
      expect(existsSync(assetPath)).toBe(true);
      if (!existsSync(assetPath)) return;

      const source = readFileSync(assetPath, "utf8");
      const document = new DOMParser().parseFromString(source, "image/svg+xml");
      const root = document.documentElement;
      const path = root.firstElementChild;

      expect(document.querySelector("parsererror")).toBeNull();
      expect(root.tagName).toBe("svg");
      expect(Array.from(root.attributes, ({ name }) => name)).toEqual(["viewBox"]);
      expect(Array.from(root.children, ({ tagName }) => tagName)).toEqual(["path"]);
      expect(Array.from(path?.attributes ?? [], ({ name }) => name)).toEqual(["d"]);
      expect(source).not.toMatch(/<\?xml|<!doctype|t=|p-id|width=|height=|xlink|https?:|<script|\son\w+=/i);
    },
  );
});
