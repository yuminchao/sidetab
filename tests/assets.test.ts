import sharp from "sharp";
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
});
