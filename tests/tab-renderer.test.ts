import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TabGroupViewModel } from "../src/sidepanel/tab-group-model";
import type { TabListItem } from "../src/sidepanel/tab-list-model";
import { createTabRenderer } from "../src/sidepanel/tab-renderer";
import type { TabViewModel } from "../src/sidepanel/tab-model";

function tab(overrides: Partial<TabViewModel> = {}): TabViewModel {
  return {
    id: 7,
    windowId: 1,
    index: 0,
    title: "Example page",
    url: "https://example.com/docs",
    domain: "example.com",
    active: false,
    pinned: false,
    groupId: -1,
    ...overrides,
  };
}

function tabItem(overrides: Partial<TabViewModel> = {}): TabListItem {
  return { kind: "tab", tab: tab(overrides) };
}

function group(overrides: Partial<TabGroupViewModel> = {}): TabGroupViewModel {
  return {
    id: 3,
    windowId: 1,
    title: "Work",
    color: "blue",
    collapsed: false,
    ...overrides,
  };
}

function groupItem(
  overrides: Partial<TabGroupViewModel> = {},
  count = 2,
): TabListItem {
  return { kind: "group", group: group(overrides), count };
}

describe("tab renderer", () => {
  let list: HTMLElement;
  let empty: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    list = document.createElement("div");
    empty = document.createElement("p");
    empty.hidden = true;
    document.body.append(list, empty);
  });

  it("renders rows incrementally with active state and accessible actions", () => {
    const replaceChildren = vi.spyOn(list, "replaceChildren");
    const renderer = createTabRenderer({ list, empty });

    renderer.render([
      tabItem({ active: true, pinned: true, favIconUrl: "data:image/png;base64,abc" }),
      tabItem({ id: -4, title: "Other", domain: "other.example" }),
    ]);

    expect(replaceChildren).not.toHaveBeenCalled();
    expect(empty.hidden).toBe(true);
    expect(list.children).toHaveLength(2);

    const row = list.firstElementChild as HTMLElement;
    expect(row).toMatchObject({ role: "listitem" });
    expect(row.dataset).toMatchObject({ tabId: "7", active: "true", pinned: "true" });
    expect(row.dataset.hasPin).toBe("true");
    expect(row.getAttribute("aria-current")).toBe("page");
    expect(row.querySelector(".tab-title")?.textContent).toBe("Example page");
    expect(row.querySelector(".tab-domain")).toBeNull();
    expect(row.querySelector<HTMLButtonElement>("[data-action='activate']")?.ariaLabel).toBe(
      "Example page，已固定",
    );
    expect(row.querySelector<HTMLButtonElement>("[data-action='close']")?.ariaLabel).toBe(
      "关闭 Example page",
    );
    expect(row.querySelector("img")).toMatchObject({ loading: "lazy", alt: "", width: 16, height: 16 });
    const main = row.querySelector<HTMLElement>(".tab-main");
    const pin = row.querySelector<HTMLElement>(".pin-indicator");
    expect(pin?.textContent).toBe("");
    expect(pin?.getAttribute("aria-hidden")).toBe("true");
    expect(main?.firstElementChild).toBe(pin);
    expect(Array.from(main?.children ?? [], (child) => child.className)).toEqual([
      "pin-indicator",
      "tab-favicon",
      "tab-title",
    ]);
    const ordinaryRow = list.children[1] as HTMLElement;
    expect(ordinaryRow.dataset.hasPin).toBe("false");
    const ordinaryPin = ordinaryRow.querySelector<HTMLElement>(".pin-indicator");
    expect(ordinaryPin?.dataset.visible).toBe("false");
    expect(ordinaryRow.querySelector(".tab-main")?.firstElementChild).toBe(ordinaryPin);
    expect(pin?.dataset.visible).toBe("true");
  });

  it("renders accessible group rows with the tab count at the end", () => {
    const renderer = createTabRenderer({ list, empty });

    renderer.render([
      groupItem({ id: 3, title: "", color: "purple", collapsed: true }),
      tabItem({ id: 7, groupId: 3 }),
    ]);

    const row = list.querySelector<HTMLElement>(".tab-group-row");
    const button = row?.querySelector<HTMLButtonElement>(".tab-group-main");
    const chevron = row?.querySelector<HTMLElement>(".tab-group-chevron");
    const count = row?.querySelector<HTMLElement>(".tab-group-count");
    expect(row?.getAttribute("role")).toBe("listitem");
    expect(row?.dataset).toMatchObject({
      groupId: "3",
      groupColor: "purple",
      collapsed: "true",
    });
    expect(button?.dataset.action).toBe("toggle-group");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(button?.ariaLabel).toBe("未命名分组，包含 2 个标签页，已折叠");
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
    expect(row?.querySelector(".tab-group-color")).toBeNull();
    expect(row?.querySelector(".tab-group-title")?.textContent).toBe("未命名分组");
    expect(count?.textContent).toBe("2");
    expect(count?.getAttribute("aria-hidden")).toBe("true");
    expect(button?.lastElementChild).toBe(count);
    expect(row?.draggable).toBe(true);
    expect(button?.draggable).toBe(false);
  });

  it("renders tree indentation and an independent accessible collapse control", () => {
    const renderer = createTabRenderer({ list, empty });
    const item = tabItem({ id: 7 });
    if (item.kind !== "tab") throw new Error("expected tab fixture");
    renderer.render([{
      ...item,
      tree: {
        depth: 2,
        hasChildren: true,
        collapsed: true,
        containsActiveDescendant: true,
      },
    }]);

    const row = list.firstElementChild as HTMLElement;
    const toggle = row.querySelector<HTMLButtonElement>(".tab-tree-toggle");
    expect(row.dataset).toMatchObject({
      treeDepth: "2",
      treeParent: "true",
      activeDescendant: "true",
    });
    expect(row.style.getPropertyValue("--tab-tree-indent")).toBe("24px");
    expect(row.getAttribute("aria-level")).toBe("3");
    expect(toggle?.hidden).toBe(false);
    expect(toggle?.dataset.action).toBe("toggle-tree");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.getAttribute("aria-label")).toBe("展开子标签，包含当前标签");
  });

  it("uses the tree control slot for a decorative leaf dot", () => {
    const renderer = createTabRenderer({ list, empty });
    const item = tabItem({ id: 7 });
    if (item.kind !== "tab") throw new Error("expected tab fixture");
    renderer.render([{
      ...item,
      tree: {
        depth: 1,
        hasChildren: false,
        collapsed: false,
        containsActiveDescendant: false,
      },
    }]);

    const row = list.firstElementChild as HTMLElement;
    expect(row.querySelector<HTMLButtonElement>(".tab-tree-toggle")?.hidden).toBe(true);
    expect(row.querySelector(".tab-tree-leaf")?.getAttribute("aria-hidden")).toBe("true");

    renderer.render([{
      ...item,
      tree: {
        depth: 0,
        hasChildren: false,
        collapsed: false,
        containsActiveDescendant: false,
      },
    }]);
    expect(row.querySelector<HTMLElement>(".tab-tree-leaf")?.hidden).toBe(true);
  });

  it("writes group decoration datasets when creating a tab row", () => {
    const renderer = createTabRenderer({ list, empty });

    renderer.render([{
      kind: "tab",
      tab: tab({ groupId: 3 }),
      group: { groupId: 3, color: "cyan", position: "single" },
    }]);

    expect((list.firstElementChild as HTMLElement).dataset).toMatchObject({
      groupId: "3",
      groupColor: "cyan",
      groupPosition: "single",
    });
  });

  it("keeps group decoration while patching tab state", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([{
      kind: "tab",
      tab: tab({ groupId: 3 }),
      group: { groupId: 3, color: "blue", position: "first" },
    }]);
    const row = list.firstElementChild as HTMLElement;

    renderer.patchTab(tab({ groupId: -1, title: "Patched", active: true }));

    expect(list.firstElementChild).toBe(row);
    expect(row.querySelector(".tab-title")?.textContent).toBe("Patched");
    expect(row.dataset).toMatchObject({
      groupId: "3",
      groupColor: "blue",
      groupPosition: "first",
    });
  });

  it("synchronizes and clears decoration only during a full render while reusing the row", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([{
      kind: "tab",
      tab: tab({ groupId: 3 }),
      group: { groupId: 3, color: "blue", position: "first" },
    }]);
    const row = list.firstElementChild as HTMLElement;

    renderer.render([{
      kind: "tab",
      tab: tab({ groupId: 4 }),
      group: { groupId: 4, color: "pink", position: "last" },
    }]);
    expect(list.firstElementChild).toBe(row);
    expect(row.dataset).toMatchObject({
      groupId: "4",
      groupColor: "pink",
      groupPosition: "last",
    });

    renderer.render([tabItem({ groupId: -1 })]);
    expect(list.firstElementChild).toBe(row);
    expect(row.dataset.groupId).toBeUndefined();
    expect(row.dataset.groupColor).toBeUndefined();
    expect(row.dataset.groupPosition).toBeUndefined();
  });

  it("patches a group row in place and ignores a missing group", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([groupItem(), tabItem({ groupId: 3 })]);
    const row = list.firstElementChild as HTMLElement;
    const button = row.querySelector(".tab-group-main");
    const title = row.querySelector(".tab-group-title");
    const tabRow = list.lastElementChild;

    renderer.patchGroup(group({ title: "Updated", color: "orange", collapsed: true }));
    renderer.patchGroup(group({ id: 999, title: "Missing" }));

    expect(list.firstElementChild).toBe(row);
    expect(row.querySelector(".tab-group-main")).toBe(button);
    expect(row.querySelector(".tab-group-title")).toBe(title);
    expect(list.lastElementChild).toBe(tabRow);
    expect(row.dataset.collapsed).toBe("true");
    expect(row.dataset.groupColor).toBe("orange");
    expect(row.querySelector(".tab-group-title")?.textContent).toBe("Updated");
    expect(row.querySelector(".tab-group-count")?.textContent).toBe("2");
    expect(row.querySelector(".tab-group-color")).toBeNull();
    expect((button as HTMLButtonElement).getAttribute("aria-expanded")).toBe("false");
    expect((button as HTMLButtonElement).ariaLabel).toBe("Updated，包含 2 个标签页，已折叠");
  });

  it("updates the group count during a full render while reusing the row", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([groupItem({}, 2)]);
    const row = list.firstElementChild as HTMLElement;

    renderer.render([groupItem({}, 5)]);

    expect(list.firstElementChild).toBe(row);
    expect(row.querySelector(".tab-group-count")?.textContent).toBe("5");
    expect((row.querySelector(".tab-group-main") as HTMLButtonElement).ariaLabel).toBe(
      "Work，包含 5 个标签页，已展开",
    );
  });

  it("keeps group rows intact while patching, removing, and toggling tab dragging", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([
      groupItem(),
      tabItem({ id: 7, groupId: 3, title: "First" }),
      tabItem({ id: 8, groupId: 3, title: "Second" }),
    ]);
    const groupRow = list.children[0] as HTMLElement;
    const firstTabRow = list.children[1] as HTMLElement;
    const secondTabRow = list.children[2] as HTMLElement;

    renderer.patchTab(tab({ id: 7, groupId: 3, title: "Updated" }));
    renderer.removeTab(8);
    renderer.setDragEnabled(false);
    renderer.setDragEnabled(true);

    expect(list.children).toHaveLength(2);
    expect(list.children[0]).toBe(groupRow);
    expect(list.children[1]).toBe(firstTabRow);
    expect(secondTabRow.isConnected).toBe(false);
    expect(groupRow.draggable).toBe(true);
    expect(groupRow.title).toBe("");
    expect(firstTabRow.querySelector(".tab-title")?.textContent).toBe("Updated");
    expect(firstTabRow.draggable).toBe(true);
  });

  it("patches expanded, empty, and HTML-looking group titles as text", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([groupItem({ collapsed: true })]);
    const row = list.firstElementChild as HTMLElement;
    const title = row.querySelector<HTMLElement>(".tab-group-title");

    renderer.patchGroup(group({ title: "<img src=x onerror=alert(1)>", collapsed: true }));
    expect(title?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(title?.querySelector("img")).toBeNull();

    renderer.patchGroup(group({ title: "", collapsed: false }));
    expect(list.firstElementChild).toBe(row);
    expect(row.querySelector(".tab-group-title")).toBe(title);
    expect(title?.textContent).toBe("未命名分组");
    expect(row.dataset.collapsed).toBe("false");
    expect(row.querySelector(".tab-group-main")?.getAttribute("aria-expanded")).toBe("true");
    expect((row.querySelector(".tab-group-main") as HTMLButtonElement).ariaLabel).toBe(
      "未命名分组，包含 2 个标签页，已展开",
    );
  });

  it("patches only a group row when another row has the same data-group-id", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tabItem({ id: 7, title: "Tab" }), groupItem({ id: 3, title: "Before" })]);
    const tabRow = list.firstElementChild as HTMLElement;
    const groupRow = list.lastElementChild as HTMLElement;
    tabRow.dataset.groupId = "3";

    renderer.patchGroup(group({ id: 3, title: "After" }));

    expect(tabRow.querySelector(".tab-title")?.textContent).toBe("Tab");
    expect(groupRow.querySelector(".tab-group-title")?.textContent).toBe("After");
  });

  it("patches and removes indexed rows without reading the list children", () => {
    const renderer = createTabRenderer({ list, empty });
    const items = Array.from({ length: 20 }, (_, index) => [
      groupItem({ id: index, title: `Group ${index}` }),
      tabItem({ id: 100 + index, groupId: index, title: `Tab ${index}` }),
    ]).flat();
    renderer.render(items);

    const nativeChildren = Object.getOwnPropertyDescriptor(Element.prototype, "children")?.get;
    if (!nativeChildren) throw new Error("missing native children getter");
    let childrenReads = 0;
    Object.defineProperty(list, "children", {
      configurable: true,
      get() {
        childrenReads += 1;
        return nativeChildren.call(list);
      },
    });
    const querySelector = vi.spyOn(list, "querySelector");
    const querySelectorAll = vi.spyOn(list, "querySelectorAll");
    const getElementsByClassName = vi.spyOn(list, "getElementsByClassName");
    const getElementsByTagName = vi.spyOn(list, "getElementsByTagName");

    for (let index = 0; index < 20; index += 1) {
      renderer.patchTab(tab({ id: 100 + index, groupId: index, title: `Updated ${index}` }));
      renderer.patchGroup(group({ id: index, title: `Updated group ${index}` }));
    }
    for (let index = 0; index < 10; index += 1) {
      renderer.removeTab(100 + index);
    }

    expect(childrenReads).toBe(0);
    expect(querySelector).not.toHaveBeenCalled();
    expect(querySelectorAll).not.toHaveBeenCalled();
    expect(getElementsByClassName).not.toHaveBeenCalled();
    expect(getElementsByTagName).not.toHaveBeenCalled();
    querySelector.mockRestore();
    querySelectorAll.mockRestore();
    getElementsByClassName.mockRestore();
    getElementsByTagName.mockRestore();
    Reflect.deleteProperty(list, "children");
    expect(list.querySelectorAll(".tab-row")).toHaveLength(10);
    expect(list.querySelectorAll(".tab-group-row")).toHaveLength(20);
  });

  it("drops stale row indexes before rendering a replacement list", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([
      groupItem({ id: 3, title: "Old group" }),
      tabItem({ id: 7, groupId: 3, title: "Old tab" }),
    ]);
    const oldGroup = list.children[0] as HTMLElement;
    const oldTab = list.children[1] as HTMLElement;

    renderer.render([
      groupItem({ id: 4, title: "New group" }),
      tabItem({ id: 8, groupId: 4, title: "New tab" }),
    ]);
    renderer.patchGroup(group({ id: 3, title: "Stale group" }));
    renderer.patchTab(tab({ id: 7, groupId: 3, title: "Stale tab" }));
    renderer.removeTab(7);

    expect(oldGroup.querySelector(".tab-group-title")?.textContent).toBe("Old group");
    expect(oldTab.querySelector(".tab-title")?.textContent).toBe("Old tab");
    expect(list.querySelector(".tab-group-title")?.textContent).toBe("New group");
    expect(list.querySelector(".tab-title")?.textContent).toBe("New tab");
  });

  it.each([
    [
      "tab",
      [tabItem({ id: 8, title: "Duplicate one" }), tabItem({ id: 8, title: "Duplicate two" })],
      "重复标签 ID: 8",
    ],
    [
      "group",
      [groupItem({ id: 4, title: "Duplicate one" }), groupItem({ id: 4, title: "Duplicate two" })],
      "重复分组 ID: 4",
    ],
  ] as const)("rejects a duplicate %s ID without replacing the current rows", (_, items, message) => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([groupItem(), tabItem({ id: 7, groupId: 3 })]);
    const oldGroup = list.children[0] as HTMLElement;
    const oldTab = list.children[1] as HTMLElement;

    expect(() => renderer.render(items)).toThrow(message);
    renderer.patchGroup(group({ title: "Patched group" }));
    renderer.patchTab(tab({ id: 7, groupId: 3, title: "Patched tab" }));

    expect(list.children[0]).toBe(oldGroup);
    expect(list.children[1]).toBe(oldTab);
    expect(oldGroup.querySelector(".tab-group-title")?.textContent).toBe("Patched group");
    expect(oldTab.querySelector(".tab-title")?.textContent).toBe("Patched tab");
  });

  it("keeps the current DOM and indexes when row creation throws", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([groupItem(), tabItem({ id: 7, groupId: 3 })]);
    const oldGroup = list.children[0] as HTMLElement;
    const oldTab = list.children[1] as HTMLElement;
    const createElement = vi.spyOn(document, "createElement").mockImplementationOnce(() => {
      throw new Error("create failed");
    });

    try {
      expect(() => renderer.render([tabItem({ id: 8 })])).toThrow("create failed");
    } finally {
      createElement.mockRestore();
    }
    renderer.patchGroup(group({ title: "Patched group" }));
    renderer.patchTab(tab({ id: 7, groupId: 3, title: "Patched tab" }));

    expect(list.children[0]).toBe(oldGroup);
    expect(list.children[1]).toBe(oldTab);
    expect(oldGroup.querySelector(".tab-group-title")?.textContent).toBe("Patched group");
    expect(oldTab.querySelector(".tab-title")?.textContent).toBe("Patched tab");
  });

  it("never replaces all children when rendering a new list", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([groupItem(), tabItem({ id: 7, groupId: 3 })]);
    const replaceChildren = vi.spyOn(list, "replaceChildren");

    renderer.render([groupItem({ id: 4 }), tabItem({ id: 8 })]);

    expect(replaceChildren).not.toHaveBeenCalled();
    expect(list.querySelector<HTMLElement>(".tab-group-row")?.dataset.groupId).toBe("4");
    expect(list.querySelector<HTMLElement>(".tab-row")?.dataset.tabId).toBe("8");
  });

  it("clears row indexes when destroyed", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([groupItem(), tabItem({ id: 7, groupId: 3 })]);
    const groupTitle = list.querySelector(".tab-group-title");
    const tabTitle = list.querySelector(".tab-title");

    renderer.destroy();
    renderer.patchGroup(group({ title: "After destroy" }));
    renderer.patchTab(tab({ id: 7, groupId: 3, title: "After destroy" }));
    renderer.removeTab(7);

    expect(groupTitle?.textContent).toBe("Work");
    expect(tabTitle?.textContent).toBe("Example page");
    expect(list.querySelectorAll(".tab-row")).toHaveLength(1);
  });

  it("shows the empty state and clears stale rows", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tabItem()]);

    renderer.render([]);

    expect(list.childElementCount).toBe(0);
    expect(empty.hidden).toBe(false);
  });

  it("patches an existing row in place without rebuilding the list", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tabItem(), tabItem({ id: 8, title: "Second" })]);
    const row = list.firstElementChild as HTMLElement;
    const second = list.lastElementChild;
    const pin = row.querySelector(".pin-indicator");

    renderer.patchTab(
      tab({
        title: "Updated",
        domain: "updated.example",
        active: true,
        pinned: true,
        favIconUrl: "data:image/png;base64,updated",
      }),
    );
    renderer.patchTab(tab({ id: 999, title: "Missing" }));

    expect(list.firstElementChild).toBe(row);
    expect(list.lastElementChild).toBe(second);
    expect(list.children).toHaveLength(2);
    expect(row.dataset).toMatchObject({ active: "true", pinned: "true" });
    expect(row.dataset.hasPin).toBe("true");
    expect(row.getAttribute("aria-current")).toBe("page");
    expect(row.querySelector(".tab-title")?.textContent).toBe("Updated");
    expect(row.querySelector(".tab-domain")).toBeNull();
    expect(row.querySelector(".tab-main")?.firstElementChild?.className).toBe("pin-indicator");
    expect(row.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,updated");

    renderer.patchTab(tab({ active: false }));
    expect(row.hasAttribute("aria-current")).toBe(false);
    expect(row.dataset.pinned).toBe("false");
    expect(row.dataset.hasPin).toBe("false");
    expect(row.querySelector(".pin-indicator")).toBe(pin);
    expect((pin as HTMLElement).dataset.visible).toBe("false");
    expect(row.querySelector<HTMLButtonElement>(".tab-main")?.ariaLabel).toBe(
      "Example page",
    );
  });

  it("preserves an image favicon until its URL changes", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tabItem({ favIconUrl: "data:image/png;base64,first" })]);
    const original = list.querySelector("img");

    renderer.patchTab(
      tab({
        title: "Updated title",
        active: true,
        favIconUrl: "data:image/png;base64,first",
      }),
    );

    expect(list.querySelector("img")).toBe(original);
    expect(original?.dataset.fallback).toBeUndefined();
    expect(list.querySelector<HTMLButtonElement>(".tab-main")?.ariaLabel).toBe(
      "Updated title",
    );

    renderer.patchTab(tab({ favIconUrl: "data:image/png;base64,second" }));
    expect(list.querySelector("img")).not.toBe(original);
    expect(list.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,second");
  });

  it("restarts the favicon chain when the page URL changes its root candidate", () => {
    const renderer = createTabRenderer({ list, empty });
    const item = tab({ favIconUrl: "data:image/png;base64,stable" });
    renderer.render([{ kind: "tab", tab: item }]);
    const original = list.querySelector("img");

    renderer.patchTab({ ...item, url: "https://other.example/page" });

    expect(list.querySelector("img")).not.toBe(original);
    expect(list.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,stable",
    );
    expect(list.querySelector<HTMLImageElement>("img")?.dataset.nextUrl).toBe(
      "https://other.example/favicon.ico",
    );
  });

  it("renders a Chrome-provided HTTPS favicon without rewriting its URL", () => {
    const renderer = createTabRenderer({ list, empty });
    const faviconUrl = "https://cdn.example.com/icons/page.png?size=16#chrome";

    renderer.render([tabItem({ title: "Private", favIconUrl: faviconUrl })]);

    expect(list.querySelector("img")?.getAttribute("src")).toBe(faviconUrl);
    expect(list.querySelector(".tab-favicon-fallback")).toBeNull();
    expect(list.querySelector(".tab-title")?.textContent).toBe("Private");
    expect(list.querySelector(".tab-domain")).toBeNull();
  });

  it("allows a Chrome-provided HTTP favicon", () => {
    const renderer = createTabRenderer({ list, empty });

    renderer.render([tabItem({ favIconUrl: "http://cdn.example/icon.png" })]);

    expect(list.querySelector("img")?.getAttribute("src")).toBe(
      "http://cdn.example/icon.png",
    );
  });

  it.each(["javascript:alert(1)", "file:///tmp/icon.png", "chrome://favicon/"])(
    "skips a dangerous primary and uses the HTTP page root: %s",
    (favIconUrl) => {
      const renderer = createTabRenderer({ list, empty });

      renderer.render([tabItem({ favIconUrl })]);

      expect(list.querySelector("img")?.getAttribute("src")).toBe(
        "https://example.com/favicon.ico",
      );
    },
  );

  it.each(["javascript:alert(1)", "file:///tmp/icon.png", "chrome://favicon/"])(
    "uses the network fallback when a non-HTTP page has no safe primary: %s",
    (favIconUrl) => {
      const renderer = createTabRenderer({ list, empty });

      renderer.render([tabItem({ title: "Private", url: "chrome://newtab/", favIconUrl })]);

      expect(list.querySelector("img")).toBeNull();
      const fallback = list.querySelector(".site-favicon-fallback.tab-favicon-fallback");
      expect(fallback?.textContent).toBe("");
      expect(fallback?.getAttribute("aria-hidden")).toBe("true");
    },
  );

  it("preserves a fallback for title changes and replaces it when favicon mode changes", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tabItem({ title: "Alpha", url: "chrome://newtab/" })]);
    const originalFallback = list.querySelector(".tab-favicon-fallback");

    renderer.patchTab(tab({ title: "Beta", active: true, url: "chrome://newtab/" }));
    expect(list.querySelector(".tab-favicon-fallback")).toBe(originalFallback);
    expect(originalFallback?.textContent).toBe("");

    renderer.patchTab(
      tab({ title: "Beta", url: "chrome://newtab/", favIconUrl: "data:image/png;base64,abc" }),
    );
    expect(list.querySelector(".tab-favicon-fallback")).toBeNull();
    expect(list.querySelector("img")).not.toBeNull();

    renderer.patchTab(tab({ title: "Gamma", url: "chrome://newtab/" }));
    expect(list.querySelector("img")).toBeNull();
    expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("");
  });

  it("removes arbitrary IDs safely and reveals the empty state after the final row", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tabItem({ id: -20 })]);

    renderer.removeTab(999);
    expect(list.children).toHaveLength(1);

    renderer.removeTab(-20);
    expect(list.children).toHaveLength(0);
    expect(empty.hidden).toBe(false);
  });

  it("falls back from the primary favicon to the root and then the network icon", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tabItem({ title: "Alpha", favIconUrl: "https://cdn.example/broken.png" })]);
    const image = list.querySelector("img");

    image?.dispatchEvent(new Event("error"));

    expect(list.querySelector("img")).toBe(image);
    expect(image?.getAttribute("src")).toBe("https://example.com/favicon.ico");
    expect(image?.dataset.nextUrl).toBe("");

    renderer.patchTab(
      tab({
        title: "Beta",
        active: true,
        favIconUrl: "https://cdn.example/broken.png",
      }),
    );
    expect(list.querySelector("img")).toBe(image);
    expect(image?.dataset.fallback).toBeUndefined();

    image?.dispatchEvent(new Event("error"));

    expect(list.querySelector("img")).toBeNull();
    expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("");
  });

  it("starts at the root favicon when Chrome provides no primary", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tabItem({ title: "Alpha" })]);
    const image = list.querySelector("img");

    expect(image?.getAttribute("src")).toBe("https://example.com/favicon.ico");
    expect(image?.dataset.nextUrl).toBe("");

    image?.dispatchEvent(new Event("error"));
    expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("");
  });

  it("does not retry a root favicon that duplicates the primary", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([
      tabItem({ title: "Alpha", favIconUrl: "https://example.com/favicon.ico" }),
    ]);
    const image = list.querySelector("img");

    expect(image?.dataset.nextUrl).toBe("");
    image?.dispatchEvent(new Event("error"));

    expect(list.querySelector("img")).toBeNull();
    expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("");
  });

  it("treats tab titles as text and never renders model domains", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([
      tabItem({
        title: "<img src=x onerror=alert(1)>",
        domain: "<script>x</script>",
        url: "chrome://newtab/",
      }),
    ]);

    expect(list.querySelector("script")).toBeNull();
    expect(list.querySelectorAll("img")).toHaveLength(0);
    expect(list.querySelector(".tab-title")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(list.querySelector(".tab-domain")).toBeNull();
  });

  it("adds and removes the pin without replacing an unchanged favicon", () => {
    const renderer = createTabRenderer({ list, empty });
    const item = tab({ favIconUrl: "data:image/png;base64,stable" });
    renderer.render([{ kind: "tab", tab: item }]);
    const favicon = list.querySelector(".tab-favicon");
    const image = list.querySelector("img");
    const pin = list.querySelector(".pin-indicator");

    expect((pin as HTMLElement).dataset.visible).toBe("false");

    renderer.patchTab({ ...item, pinned: true });
    expect(list.querySelector(".pin-indicator")).toBe(pin);
    expect((pin as HTMLElement).dataset.visible).toBe("true");
    expect(list.querySelector(".pin-indicator")).toBe(list.querySelector(".tab-main")?.firstElementChild);
    expect(list.querySelector(".tab-favicon")).toBe(favicon);
    expect(list.querySelector("img")).toBe(image);

    renderer.patchTab(item);
    expect(list.querySelector(".pin-indicator")).toBe(pin);
    expect((pin as HTMLElement).dataset.visible).toBe("false");
    expect(list.querySelector(".tab-favicon")).toBe(favicon);
    expect(list.querySelector("img")).toBe(image);
  });

  it("removes delegated listeners when destroyed", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tabItem({ favIconUrl: "data:image/png;base64,broken" })]);
    const image = list.querySelector("img");

    renderer.destroy();
    image?.dispatchEvent(new Event("error"));

    expect(list.querySelector("img")).toBe(image);
  });

  it("keeps row drag availability across render and patch", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tabItem()]);
    const row = list.firstElementChild as HTMLElement;
    expect(row.draggable).toBe(true);

    renderer.setDragEnabled(false);
    expect(row.draggable).toBe(false);
    expect(row.title).toBe("清空搜索后可排序");
    renderer.render([tabItem({ title: "Again" })]);
    const rerendered = list.firstElementChild as HTMLElement;
    expect(rerendered.draggable).toBe(false);

    renderer.setDragEnabled(true);
    renderer.patchTab(tab({ title: "Patched" }));
    expect(rerendered.draggable).toBe(true);
    expect(rerendered.title).toBe("");
  });

  it("toggles drag availability for created and reused group rows", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.setDragEnabled(false);
    renderer.render([groupItem(), tabItem({ groupId: 3 })]);
    const groupRow = list.firstElementChild as HTMLElement;
    const groupMain = groupRow.querySelector<HTMLElement>(".tab-group-main")!;
    expect(groupRow.draggable).toBe(false);
    expect(groupMain.draggable).toBe(false);

    renderer.setDragEnabled(true);
    renderer.render([groupItem({ title: "Reused" }), tabItem({ groupId: 3 })]);
    expect(list.firstElementChild).toBe(groupRow);
    expect(groupRow.draggable).toBe(true);
    expect(groupMain.draggable).toBe(false);

    renderer.setDragEnabled(false);
    expect(groupRow.draggable).toBe(false);
  });

  it("keeps group rows draggable when only tab dragging is disabled", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([groupItem(), tabItem({ groupId: 3 })]);
    const groupRow = list.firstElementChild as HTMLElement;
    const tabRow = list.lastElementChild as HTMLElement;

    renderer.setTabDragEnabled(false);

    expect(tabRow.draggable).toBe(false);
    expect(groupRow.draggable).toBe(true);
  });

  it("does not expose tab title text in the favicon fallback", () => {
    const renderer = createTabRenderer({ list, empty });

    renderer.render([tabItem({ title: "😀 Tab", url: "chrome://newtab/" })]);

    expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("");
  });

  it("renders and patches one hundred rows without replacing their nodes", () => {
    const renderer = createTabRenderer({ list, empty });
    const tabs = Array.from({ length: 100 }, (_, index) =>
      tab({ id: index - 50, index, title: `Tab ${index}` }),
    );
    renderer.render(tabs.map((tab) => ({ kind: "tab" as const, tab })));
    const rows = Array.from(list.children);

    for (const item of tabs) {
      renderer.patchTab({ ...item, title: `${item.title} updated`, pinned: true });
    }

    expect(list.children).toHaveLength(100);
    expect(Array.from(list.children)).toEqual(rows);
    expect(list.lastElementChild?.querySelector(".tab-title")?.textContent).toBe(
      "Tab 99 updated",
    );
  });

  it("reorders five hundred rows while preserving every keyed node", () => {
    const renderer = createTabRenderer({ list, empty });
    const tabs = Array.from({ length: 500 }, (_, index) =>
      tab({ id: index + 1, index, title: `Tab ${index}` }),
    );
    renderer.render(tabs.map((item) => ({ kind: "tab" as const, tab: item })));
    const original = new Map(
      Array.from(list.querySelectorAll<HTMLElement>(".tab-row"), (row) => [
        row.dataset.tabId,
        row,
      ]),
    );
    const reordered = [...tabs];
    [reordered[0], reordered[499]] = [reordered[499]!, reordered[0]!];

    renderer.render(reordered.map((item) => ({ kind: "tab" as const, tab: item })));

    expect(list.firstElementChild).toBe(original.get("500"));
    expect(list.lastElementChild).toBe(original.get("1"));
    for (const row of Array.from(list.querySelectorAll<HTMLElement>(".tab-row"))) {
      expect(row).toBe(original.get(row.dataset.tabId));
    }
  });

  it("adds and removes only the changed keyed rows", () => {
    const replaceChildren = vi.spyOn(list, "replaceChildren");
    const renderer = createTabRenderer({ list, empty });
    renderer.render([
      tabItem({ id: 1, favIconUrl: "data:image/png;base64,one" }),
      tabItem({ id: 2, favIconUrl: "data:image/png;base64,two" }),
    ]);
    const first = list.children[0] as HTMLElement;
    const second = list.children[1] as HTMLElement;
    const firstImage = first.querySelector("img");

    renderer.render([
      tabItem({ id: 1, favIconUrl: "data:image/png;base64,one" }),
      tabItem({ id: 2, favIconUrl: "data:image/png;base64,two" }),
      tabItem({ id: 3, favIconUrl: "data:image/png;base64,three" }),
    ]);
    const third = list.children[2] as HTMLElement;
    renderer.render([
      tabItem({ id: 1, favIconUrl: "data:image/png;base64,one" }),
      tabItem({ id: 3, favIconUrl: "data:image/png;base64,three" }),
    ]);

    expect(replaceChildren).not.toHaveBeenCalled();
    expect(list.children).toHaveLength(2);
    expect(list.children[0]).toBe(first);
    expect(list.children[1]).toBe(third);
    expect(first.querySelector("img")).toBe(firstImage);
    expect(second.isConnected).toBe(false);
  });
});
