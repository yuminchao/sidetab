import { beforeEach, describe, expect, it, vi } from "vitest";
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
    ...overrides,
  };
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

  it("renders rows through a fragment with active state and accessible actions", () => {
    const replaceChildren = vi.spyOn(list, "replaceChildren");
    const renderer = createTabRenderer({ list, empty });

    renderer.render([
      tab({ active: true, pinned: true, favIconUrl: "data:image/png;base64,abc" }),
      tab({ id: -4, title: "Other", domain: "other.example" }),
    ]);

    expect(replaceChildren).toHaveBeenCalledOnce();
    expect(replaceChildren.mock.calls[0]?.[0]).toBeInstanceOf(DocumentFragment);
    expect(empty.hidden).toBe(true);
    expect(list.children).toHaveLength(2);

    const row = list.firstElementChild as HTMLElement;
    expect(row).toMatchObject({ role: "listitem" });
    expect(row.dataset).toMatchObject({ tabId: "7", active: "true", pinned: "true" });
    expect(row.getAttribute("aria-current")).toBe("page");
    expect(row.querySelector(".tab-title")?.textContent).toBe("Example page");
    expect(row.querySelector(".tab-domain")?.textContent).toBe("example.com");
    expect(row.querySelector<HTMLButtonElement>("[data-action='activate']")?.ariaLabel).toBe(
      "切换到 Example page，已固定",
    );
    expect(row.querySelector<HTMLButtonElement>("[data-action='close']")?.ariaLabel).toBe(
      "关闭 Example page",
    );
    expect(row.querySelector("img")).toMatchObject({ loading: "lazy", alt: "", width: 16, height: 16 });
    expect(row.querySelector(".pin-indicator")?.textContent).toBe("固定");
    expect(row.querySelector<HTMLElement>(".pin-indicator")?.title).toBe("已固定");
    expect(list.children[1]?.querySelector(".pin-indicator")).not.toBeNull();
  });

  it("shows the empty state and clears stale rows", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tab()]);

    renderer.render([]);

    expect(list.childElementCount).toBe(0);
    expect(empty.hidden).toBe(false);
  });

  it("patches an existing row in place without rebuilding the list", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tab(), tab({ id: 8, title: "Second" })]);
    const row = list.firstElementChild as HTMLElement;
    const second = list.lastElementChild;

    renderer.patch(
      tab({
        title: "Updated",
        domain: "updated.example",
        active: true,
        pinned: true,
        favIconUrl: "https://updated.example/icon.png",
      }),
    );
    renderer.patch(tab({ id: 999, title: "Missing" }));

    expect(list.firstElementChild).toBe(row);
    expect(list.lastElementChild).toBe(second);
    expect(list.children).toHaveLength(2);
    expect(row.dataset).toMatchObject({ active: "true", pinned: "true" });
    expect(row.getAttribute("aria-current")).toBe("page");
    expect(row.querySelector(".tab-title")?.textContent).toBe("Updated");
    expect(row.querySelector(".tab-domain")?.textContent).toBe("updated.example");
    expect(row.querySelector("img")?.getAttribute("src")).toBe("https://updated.example/icon.png");

    renderer.patch(tab({ active: false }));
    expect(row.hasAttribute("aria-current")).toBe(false);
    expect(row.dataset.pinned).toBe("false");
    expect(row.querySelector<HTMLButtonElement>(".tab-main")?.ariaLabel).toBe(
      "切换到 Example page",
    );
  });

  it("preserves an image favicon until its URL changes", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tab({ favIconUrl: "https://example.com/icon.png" })]);
    const original = list.querySelector("img");

    renderer.patch(
      tab({
        title: "Updated title",
        active: true,
        favIconUrl: "https://example.com/icon.png",
      }),
    );

    expect(list.querySelector("img")).toBe(original);
    expect(original?.dataset.fallback).toBe("U");
    expect(list.querySelector<HTMLButtonElement>(".tab-main")?.ariaLabel).toBe(
      "切换到 Updated title",
    );

    renderer.patch(tab({ favIconUrl: "https://example.com/new-icon.png" }));
    expect(list.querySelector("img")).not.toBe(original);
    expect(list.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/new-icon.png",
    );
  });

  it("preserves a fallback for title changes and replaces it when favicon mode changes", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tab({ title: "Alpha" })]);
    const originalFallback = list.querySelector(".tab-favicon-fallback");

    renderer.patch(tab({ title: "Beta", active: true }));
    expect(list.querySelector(".tab-favicon-fallback")).toBe(originalFallback);
    expect(originalFallback?.textContent).toBe("B");

    renderer.patch(tab({ title: "Beta", favIconUrl: "data:image/png;base64,abc" }));
    expect(list.querySelector(".tab-favicon-fallback")).toBeNull();
    expect(list.querySelector("img")).not.toBeNull();

    renderer.patch(tab({ title: "Gamma" }));
    expect(list.querySelector("img")).toBeNull();
    expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("G");
  });

  it("removes arbitrary IDs safely and reveals the empty state after the final row", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tab({ id: -20 })]);

    renderer.remove(999);
    expect(list.children).toHaveLength(1);

    renderer.remove(-20);
    expect(list.children).toHaveLength(0);
    expect(empty.hidden).toBe(false);
  });

  it("replaces a failed favicon through one delegated error handler", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tab({ title: "Alpha", favIconUrl: "https://example.com/broken.png" })]);
    const image = list.querySelector("img");

    image?.dispatchEvent(new Event("error"));

    expect(list.querySelector("img")).toBeNull();
    expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("A");
  });

  it("treats tab titles and domains as text", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tab({ title: "<img src=x onerror=alert(1)>", domain: "<script>x</script>" })]);

    expect(list.querySelector("script")).toBeNull();
    expect(list.querySelectorAll("img")).toHaveLength(0);
    expect(list.querySelector(".tab-title")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(list.querySelector(".tab-domain")?.textContent).toBe("<script>x</script>");
  });

  it("removes delegated listeners when destroyed", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tab({ favIconUrl: "https://example.com/broken.png" })]);
    const image = list.querySelector("img");

    renderer.destroy();
    image?.dispatchEvent(new Event("error"));

    expect(list.querySelector("img")).toBe(image);
  });

  it("keeps an emoji intact when deriving a favicon fallback", () => {
    const renderer = createTabRenderer({ list, empty });

    renderer.render([tab({ title: "😀 Tab" })]);

    expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("😀");
  });

  it("renders and patches one hundred rows without replacing their nodes", () => {
    const renderer = createTabRenderer({ list, empty });
    const tabs = Array.from({ length: 100 }, (_, index) =>
      tab({ id: index - 50, index, title: `Tab ${index}` }),
    );
    renderer.render(tabs);
    const rows = Array.from(list.children);

    for (const item of tabs) {
      renderer.patch({ ...item, title: `${item.title} updated`, pinned: true });
    }

    expect(list.children).toHaveLength(100);
    expect(Array.from(list.children)).toEqual(rows);
    expect(list.lastElementChild?.querySelector(".tab-title")?.textContent).toBe(
      "Tab 99 updated",
    );
  });
});
