import { describe, expect, it } from "vitest";
import {
  createFaviconCandidates,
  createOriginFaviconMap,
  getAllowedImageUrl,
  getHttpOrigin,
} from "../src/sidepanel/favicon-model";
import type { TabViewModel } from "../src/sidepanel/tab-model";

function tab(overrides: Partial<TabViewModel> = {}): TabViewModel {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    title: "Example",
    url: "https://example.com/page",
    domain: "example.com",
    active: false,
    pinned: false,
    groupId: -1,
    ...overrides,
  };
}

describe("favicon model", () => {
  describe("getAllowedImageUrl", () => {
    it("preserves data images", () => {
      const image = "data:image/png;base64,abc";

      expect(getAllowedImageUrl(image)).toBe(image);
    });

    it("normalizes HTTP and HTTPS image URLs", () => {
      expect(getAllowedImageUrl("https://cdn.example/icon.png#mark")).toBe(
        "https://cdn.example/icon.png#mark",
      );
      expect(getAllowedImageUrl("http://cdn.example/icon.png")).toBe(
        "http://cdn.example/icon.png",
      );
    });

    it.each([undefined, "", "not a URL", "javascript:alert(1)", "file:///icon.png", "chrome://favicon/"])(
      "rejects a disallowed image URL: %s",
      (raw) => {
        expect(getAllowedImageUrl(raw)).toBe("");
      },
    );
  });

  describe("getHttpOrigin", () => {
    it("returns HTTP origins including explicit ports", () => {
      expect(getHttpOrigin("https://example.com:8443/path?q=1")).toBe(
        "https://example.com:8443",
      );
      expect(getHttpOrigin("http://example.com/path")).toBe("http://example.com");
    });

    it.each(["chrome://newtab/", "file:///tmp/page.html", "not a URL"])(
      "rejects a non-HTTP page origin: %s",
      (raw) => {
        expect(getHttpOrigin(raw)).toBe("");
      },
    );
  });

  describe("createFaviconCandidates", () => {
    it("puts a safe HTTPS favicon before the page root favicon", () => {
      expect(
        createFaviconCandidates(
          "https://cdn.example/icon.png",
          "https://example.com/docs/page",
        ),
      ).toEqual([
        "https://cdn.example/icon.png",
        "https://example.com/favicon.ico",
      ]);
    });

    it("accepts an HTTP primary favicon", () => {
      expect(
        createFaviconCandidates("http://example.com/icon.png", "http://example.com/page"),
      ).toEqual([
        "http://example.com/icon.png",
        "http://example.com/favicon.ico",
      ]);
    });

    it("does not create a root favicon for a Chrome page", () => {
      expect(
        createFaviconCandidates("data:image/svg+xml,<svg></svg>", "chrome://newtab/"),
      ).toEqual(["data:image/svg+xml,<svg></svg>"]);
    });

    it("filters dangerous primaries and removes duplicate root candidates", () => {
      expect(
        createFaviconCandidates("javascript:alert(1)", "https://example.com/page"),
      ).toEqual(["https://example.com/favicon.ico"]);
      expect(
        createFaviconCandidates(
          "https://example.com/favicon.ico",
          "https://example.com/page",
        ),
      ).toEqual(["https://example.com/favicon.ico"]);
    });
  });

  describe("createOriginFaviconMap", () => {
    it("prefers the active tab favicon within an origin", () => {
      const result = createOriginFaviconMap([
        tab({ id: 1, index: 0, favIconUrl: "https://example.com/first.png" }),
        tab({ id: 2, index: 4, active: true, favIconUrl: "data:image/png;base64,active" }),
      ]);

      expect(result.get("https://example.com")).toBe("data:image/png;base64,active");
    });

    it("uses the smallest Chrome index when no tab is active", () => {
      const result = createOriginFaviconMap([
        tab({ id: 1, index: 7, favIconUrl: "https://example.com/later.png" }),
        tab({ id: 2, index: 2, favIconUrl: "https://example.com/earlier.png" }),
      ]);

      expect(result.get("https://example.com")).toBe("https://example.com/earlier.png");
    });

    it("ignores invalid favicons without blocking a later valid tab", () => {
      const result = createOriginFaviconMap([
        tab({ id: 1, index: 0, active: true, favIconUrl: "javascript:alert(1)" }),
        tab({ id: 2, index: 1, favIconUrl: "http://example.com/valid.png" }),
        tab({ id: 3, index: 2, url: "chrome://newtab/", favIconUrl: "data:image/png;base64,chrome" }),
      ]);

      expect(Array.from(result.entries())).toEqual([
        ["https://example.com", "http://example.com/valid.png"],
      ]);
    });

    it("selects favicons independently for different origins", () => {
      const result = createOriginFaviconMap([
        tab({
          id: 1,
          index: 5,
          url: "https://first.example/page",
          favIconUrl: "https://icons.example/first.png",
        }),
        tab({
          id: 2,
          index: 1,
          url: "https://second.example/page",
          favIconUrl: "data:image/png;base64,second",
        }),
      ]);

      expect(result).toEqual(
        new Map([
          ["https://first.example", "https://icons.example/first.png"],
          ["https://second.example", "data:image/png;base64,second"],
        ]),
      );
    });
  });
});
