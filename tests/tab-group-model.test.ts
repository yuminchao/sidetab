import { describe, expect, it } from "vitest";
import {
  TAB_GROUP_COLORS,
  toTabGroupViewModel,
} from "../src/sidepanel/tab-group-model";

function group(
  overrides: Partial<chrome.tabGroups.TabGroup> = {},
): chrome.tabGroups.TabGroup {
  return {
    id: 4,
    windowId: 10,
    title: "  Work  ",
    color: "blue",
    collapsed: false,
    ...overrides,
  } as chrome.tabGroups.TabGroup;
}

describe("tab group model", () => {
  it("exports every Chrome tab group color in palette order", () => {
    expect(TAB_GROUP_COLORS).toEqual([
      "grey",
      "blue",
      "red",
      "yellow",
      "green",
      "pink",
      "purple",
      "cyan",
      "orange",
    ]);
  });

  it("maps Chrome group metadata and trims its title", () => {
    expect(toTabGroupViewModel(group())).toEqual({
      id: 4,
      windowId: 10,
      title: "Work",
      color: "blue",
      collapsed: false,
    });
  });

  it("preserves an empty title without mutating the Chrome group", () => {
    const input = group({ title: undefined, collapsed: true });

    expect(toTabGroupViewModel(input)).toEqual({
      id: 4,
      windowId: 10,
      title: "",
      color: "blue",
      collapsed: true,
    });
    expect(input).toEqual(group({ title: undefined, collapsed: true }));
  });

  it("rejects a group without an ID using a domain error", () => {
    expect(() => toTabGroupViewModel(group({ id: undefined }))).toThrow(
      "标签组缺少 ID",
    );
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid Chrome group ID %s", (id) => {
    expect(() => toTabGroupViewModel(group({ id }))).toThrow("标签组缺少 ID");
  });
});
