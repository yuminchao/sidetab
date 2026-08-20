import { describe, expect, it } from "vitest";
import { isFloatingBallRequest, type FloatingBallRequest } from "../src/floating-ball/messages";

describe("floating ball messages", () => {
  it("accepts supported messages and rejects forged target ids", () => {
    const request: FloatingBallRequest = { type: "floating-ball/toggle-pin" };

    expect(isFloatingBallRequest(request)).toBe(true);
    expect(isFloatingBallRequest({ type: "floating-ball/toggle-pin", tabId: 99 })).toBe(false);
  });

  it("validates search text and search result URLs", () => {
    expect(isFloatingBallRequest({ type: "floating-ball/search", query: " chrome " })).toBe(true);
    expect(isFloatingBallRequest({ type: "floating-ball/search", query: "chrome", tabId: 99 })).toBe(false);
    expect(isFloatingBallRequest({ type: "floating-ball/search", query: "x".repeat(201) })).toBe(false);
    expect(isFloatingBallRequest({
      type: "floating-ball/open-search-result",
      url: "https://example.com/",
    })).toBe(true);
    expect(isFloatingBallRequest({
      type: "floating-ball/open-search-result",
      url: "https://example.com/",
      tabId: 99,
    })).toBe(false);
    expect(isFloatingBallRequest({
      type: "floating-ball/open-search-result",
      url: "javascript:alert(1)",
    })).toBe(false);
  });
});
