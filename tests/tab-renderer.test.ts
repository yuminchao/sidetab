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
    const pin = row.querySelector(".pin-indicator");

    renderer.patch(
      tab({
        title: "Updated",
        domain: "updated.example",
        active: true,
        pinned: true,
        favIconUrl: "data:image/png;base64,updated",
      }),
    );
    renderer.patch(tab({ id: 999, title: "Missing" }));

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

    renderer.patch(tab({ active: false }));
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
    renderer.render([tab({ favIconUrl: "data:image/png;base64,first" })]);
    const original = list.querySelector("img");

    renderer.patch(
      tab({
        title: "Updated title",
        active: true,
        favIconUrl: "data:image/png;base64,first",
      }),
    );

    expect(list.querySelector("img")).toBe(original);
    expect(original?.dataset.fallback).toBe("U");
    expect(list.querySelector<HTMLButtonElement>(".tab-main")?.ariaLabel).toBe(
      "Updated title",
    );

    renderer.patch(tab({ favIconUrl: "data:image/png;base64,second" }));
    expect(list.querySelector("img")).not.toBe(original);
    expect(list.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,second");
  });

  it("restarts the favicon chain when the page URL changes its root candidate", () => {
    const renderer = createTabRenderer({ list, empty });
    const item = tab({ favIconUrl: "data:image/png;base64,stable" });
    renderer.render([item]);
    const original = list.querySelector("img");

    renderer.patch({ ...item, url: "https://other.example/page" });

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

    renderer.render([tab({ title: "Private", favIconUrl: faviconUrl })]);

    expect(list.querySelector("img")?.getAttribute("src")).toBe(faviconUrl);
    expect(list.querySelector(".tab-favicon-fallback")).toBeNull();
    expect(list.querySelector(".tab-title")?.textContent).toBe("Private");
    expect(list.querySelector(".tab-domain")).toBeNull();
  });

  it("allows a Chrome-provided HTTP favicon", () => {
    const renderer = createTabRenderer({ list, empty });

    renderer.render([tab({ favIconUrl: "http://cdn.example/icon.png" })]);

    expect(list.querySelector("img")?.getAttribute("src")).toBe(
      "http://cdn.example/icon.png",
    );
  });

  it.each(["javascript:alert(1)", "file:///tmp/icon.png", "chrome://favicon/"])(
    "skips a dangerous primary and uses the HTTP page root: %s",
    (favIconUrl) => {
      const renderer = createTabRenderer({ list, empty });

      renderer.render([tab({ favIconUrl })]);

      expect(list.querySelector("img")?.getAttribute("src")).toBe(
        "https://example.com/favicon.ico",
      );
    },
  );

  it.each(["javascript:alert(1)", "file:///tmp/icon.png", "chrome://favicon/"])(
    "uses a letter when a non-HTTP page has no safe primary: %s",
    (favIconUrl) => {
      const renderer = createTabRenderer({ list, empty });

      renderer.render([tab({ title: "Private", url: "chrome://newtab/", favIconUrl })]);

      expect(list.querySelector("img")).toBeNull();
      expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("P");
    },
  );

  it("preserves a fallback for title changes and replaces it when favicon mode changes", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tab({ title: "Alpha", url: "chrome://newtab/" })]);
    const originalFallback = list.querySelector(".tab-favicon-fallback");

    renderer.patch(tab({ title: "Beta", active: true, url: "chrome://newtab/" }));
    expect(list.querySelector(".tab-favicon-fallback")).toBe(originalFallback);
    expect(originalFallback?.textContent).toBe("B");

    renderer.patch(
      tab({ title: "Beta", url: "chrome://newtab/", favIconUrl: "data:image/png;base64,abc" }),
    );
    expect(list.querySelector(".tab-favicon-fallback")).toBeNull();
    expect(list.querySelector("img")).not.toBeNull();

    renderer.patch(tab({ title: "Gamma", url: "chrome://newtab/" }));
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

  it("falls back from the primary favicon to the root and then the title letter", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tab({ title: "Alpha", favIconUrl: "https://cdn.example/broken.png" })]);
    const image = list.querySelector("img");

    image?.dispatchEvent(new Event("error"));

    expect(list.querySelector("img")).toBe(image);
    expect(image?.getAttribute("src")).toBe("https://example.com/favicon.ico");
    expect(image?.dataset.nextUrl).toBe("");

    renderer.patch(
      tab({
        title: "Beta",
        active: true,
        favIconUrl: "https://cdn.example/broken.png",
      }),
    );
    expect(list.querySelector("img")).toBe(image);
    expect(image?.dataset.fallback).toBe("B");

    image?.dispatchEvent(new Event("error"));

    expect(list.querySelector("img")).toBeNull();
    expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("B");
  });

  it("starts at the root favicon when Chrome provides no primary", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tab({ title: "Alpha" })]);
    const image = list.querySelector("img");

    expect(image?.getAttribute("src")).toBe("https://example.com/favicon.ico");
    expect(image?.dataset.nextUrl).toBe("");

    image?.dispatchEvent(new Event("error"));
    expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("A");
  });

  it("does not retry a root favicon that duplicates the primary", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([
      tab({ title: "Alpha", favIconUrl: "https://example.com/favicon.ico" }),
    ]);
    const image = list.querySelector("img");

    expect(image?.dataset.nextUrl).toBe("");
    image?.dispatchEvent(new Event("error"));

    expect(list.querySelector("img")).toBeNull();
    expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("A");
  });

  it("treats tab titles as text and never renders model domains", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([
      tab({
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
    renderer.render([item]);
    const favicon = list.querySelector(".tab-favicon");
    const image = list.querySelector("img");
    const pin = list.querySelector(".pin-indicator");

    expect((pin as HTMLElement).dataset.visible).toBe("false");

    renderer.patch({ ...item, pinned: true });
    expect(list.querySelector(".pin-indicator")).toBe(pin);
    expect((pin as HTMLElement).dataset.visible).toBe("true");
    expect(list.querySelector(".pin-indicator")).toBe(list.querySelector(".tab-main")?.firstElementChild);
    expect(list.querySelector(".tab-favicon")).toBe(favicon);
    expect(list.querySelector("img")).toBe(image);

    renderer.patch(item);
    expect(list.querySelector(".pin-indicator")).toBe(pin);
    expect((pin as HTMLElement).dataset.visible).toBe("false");
    expect(list.querySelector(".tab-favicon")).toBe(favicon);
    expect(list.querySelector("img")).toBe(image);
  });

  it("removes delegated listeners when destroyed", () => {
    const renderer = createTabRenderer({ list, empty });
    renderer.render([tab({ favIconUrl: "data:image/png;base64,broken" })]);
    const image = list.querySelector("img");

    renderer.destroy();
    image?.dispatchEvent(new Event("error"));

    expect(list.querySelector("img")).toBe(image);
  });

  it("keeps an emoji intact when deriving a favicon fallback", () => {
    const renderer = createTabRenderer({ list, empty });

    renderer.render([tab({ title: "😀 Tab", url: "chrome://newtab/" })]);

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
