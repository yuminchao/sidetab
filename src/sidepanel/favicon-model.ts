import type { TabViewModel } from "./tab-model";

export function getAllowedImageUrl(raw?: string): string {
  if (!raw) {
    return "";
  }

  if (/^data:image\//i.test(raw)) {
    return raw;
  }

  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function getHttpOrigin(raw: string): string {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

export function createFaviconCandidates(
  favIconUrl: string | undefined,
  pageUrl: string,
): string[] {
  const primary = getAllowedImageUrl(favIconUrl);
  const origin = getHttpOrigin(pageUrl);
  const root = origin ? `${origin}/favicon.ico` : "";

  return Array.from(new Set([primary, root].filter(Boolean)));
}

type OriginFaviconCandidate = {
  favIconUrl: string;
  active: boolean;
  index: number;
  id: number;
};

export function createOriginFaviconMap(
  tabs: readonly TabViewModel[],
): ReadonlyMap<string, string> {
  const selected = new Map<string, OriginFaviconCandidate>();

  for (const tab of tabs) {
    const origin = getHttpOrigin(tab.url);
    const favIconUrl = getAllowedImageUrl(tab.favIconUrl);
    if (!origin || !favIconUrl) {
      continue;
    }

    const candidate = {
      favIconUrl,
      active: tab.active,
      index: tab.index,
      id: tab.id,
    };
    const current = selected.get(origin);
    if (!current || compareCandidates(candidate, current) < 0) {
      selected.set(origin, candidate);
    }
  }

  return new Map(
    Array.from(selected.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([origin, candidate]) => [origin, candidate.favIconUrl]),
  );
}

function compareCandidates(
  left: OriginFaviconCandidate,
  right: OriginFaviconCandidate,
): number {
  if (left.active !== right.active) {
    return left.active ? -1 : 1;
  }
  return left.index - right.index || left.id - right.id;
}
