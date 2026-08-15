import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";

const storeAssetsDirectory = path.resolve("store-assets", "0.12.1");

const imageCases = [
  {
    name: "screenshot-1280x800.png is an opaque 1280x800 sRGB PNG",
    filename: "screenshot-1280x800.png",
    width: 1280,
    height: 800,
  },
  {
    name: "small-promo-440x280.png is an opaque 440x280 sRGB PNG",
    filename: "small-promo-440x280.png",
    width: 440,
    height: 280,
  },
  {
    name: "marquee-1400x560.png is an opaque 1400x560 sRGB PNG",
    filename: "marquee-1400x560.png",
    width: 1400,
    height: 560,
  },
] as const;

describe("Chrome Web Store image assets", () => {
  for (const imageCase of imageCases) {
    it(imageCase.name, async () => {
      const metadata = await sharp(
        path.join(storeAssetsDirectory, imageCase.filename),
      ).metadata();

      expect(metadata.format).toBe("png");
      expect(metadata.width).toBe(imageCase.width);
      expect(metadata.height).toBe(imageCase.height);
      expect(metadata.space).toBe("srgb");
      expect(metadata.channels).toBe(3);
      expect(metadata.hasAlpha).toBe(false);
    });
  }
});
