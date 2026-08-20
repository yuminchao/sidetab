import type { SearchResult } from "../sidepanel/search-result-model";

export type FloatingBallRequest =
  | { type: "floating-ball/search"; query: string }
  | { type: "floating-ball/open-search-result"; url: string }
  | { type: "floating-ball/duplicate-tab" }
  | { type: "floating-ball/get-tab-state" }
  | { type: "floating-ball/toggle-pin" }
  | { type: "floating-ball/close-tab" }
  | { type: "floating-ball/open-side-panel" }
  | { type: "floating-ball/smart-group-window" }
  | { type: "floating-ball/ensure-injected" };

export type FloatingBallResponse<T = undefined> =
  | { ok: true; value?: T }
  | { ok: false; error: string; message: string };

export type FloatingBallSearchResponse = FloatingBallResponse<readonly SearchResult[]>;

/**
 * 判断未知消息是否为悬浮球支持的请求。
 *
 * @param value 待校验的运行时消息。
 * @returns 消息结构、字段类型和安全边界均有效时返回 true。
 */
export function isFloatingBallRequest(value: unknown): value is FloatingBallRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const type = candidate.type;
  if (typeof type !== "string" || !type.startsWith("floating-ball/")) return false;

  if (type === "floating-ball/search") {
    return Object.keys(candidate).length === 2
      && typeof candidate.query === "string"
      && candidate.query.trim().length <= 200;
  }
  if (type === "floating-ball/open-search-result") {
    if (Object.keys(candidate).length !== 2 || typeof candidate.url !== "string") return false;
    try {
      const url = new URL(candidate.url);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  const supported = [
    "floating-ball/duplicate-tab",
    "floating-ball/get-tab-state",
    "floating-ball/toggle-pin",
    "floating-ball/close-tab",
    "floating-ball/open-side-panel",
    "floating-ball/smart-group-window",
    "floating-ball/ensure-injected",
  ].includes(type);
  if (!supported) return false;
  return Object.keys(candidate).length === 1;
}
