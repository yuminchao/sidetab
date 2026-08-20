import {
  clampBallPosition,
  exceedsDragThreshold,
  toRatioPosition,
} from "./position";
import type { FloatingBallSettings, FloatingBallSettingsStore } from "./settings";
import type { FloatingBallRequest, FloatingBallResponse } from "./messages";

type Runtime = { sendMessage(message: FloatingBallRequest): Promise<FloatingBallResponse<unknown>> };
type ControllerDependencies = {
  document: Document;
  window: Window;
  settings: FloatingBallSettingsStore;
  runtime: Runtime;
};

export type FloatingBallController = {
  /**
   * 应用悬浮球设置并同步界面生命周期。
   *
   * @param settings 当前持久化配置。
   * @returns 界面完成挂载或卸载时解决的 Promise。
   */
  applySettings(settings: FloatingBallSettings): Promise<void>;
  /**
   * 销毁页面中的悬浮球和全部事件监听。
   *
   * @returns 无返回值。
   */
  destroy(): void;
};

/**
 * 创建网页悬浮球控制器。
 *
 * @param deps 页面 DOM、窗口、设置存储和后台消息适配器。
 * @returns 可重复应用设置的控制器。
 */
export function createFloatingBallController(
  deps: ControllerDependencies,
): FloatingBallController {
  let host: HTMLElement | undefined;
  let cleanup: (() => void) | undefined;
  let currentSettings: FloatingBallSettings | undefined;
  let requestGeneration = 0;
  let searchTimer: number | undefined;

  const applySettings = async (settings: FloatingBallSettings): Promise<void> => {
    currentSettings = settings;
    if (!settings.enabled) {
      remove();
      return;
    }
    if (!host) mount(settings);
    else positionHost(settings);
  };

  const destroy = (): void => {
    remove();
    currentSettings = undefined;
  };

  function mount(settings: FloatingBallSettings): void {
    host = deps.document.createElement("div");
    host.dataset.sidetabFloatingBallHost = "true";
    host.style.position = "fixed";
    host.style.width = "44px";
    host.style.height = "44px";
    host.style.zIndex = "2147483647";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(createStyle(deps.document));
    const widget = deps.document.createElement("div");
    widget.className = "widget";
    const search = deps.document.createElement("div");
    search.className = "search";
    search.hidden = true;
    const results = deps.document.createElement("div");
    results.className = "results";
    const input = deps.document.createElement("input");
    input.type = "search";
    input.placeholder = "搜索收藏夹和历史记录";
    input.setAttribute("aria-label", "搜索收藏夹和历史记录");
    search.append(results, input);
    const ball = deps.document.createElement("button");
    ball.type = "button";
    ball.dataset.action = "toggle-search";
    ball.title = "打开 SideTab Lite 搜索";
    ball.setAttribute("aria-label", "打开 SideTab Lite 搜索");
    ball.innerHTML = "<span class=\"ball-icon\" aria-hidden=\"true\"></span>";
    widget.append(search, ball);
    const menu = deps.document.createElement("div");
    menu.className = "menu";
    menu.hidden = true;
    const notice = deps.document.createElement("div");
    notice.className = "notice";
    notice.hidden = true;
    notice.setAttribute("role", "status");
    notice.style.cssText = "position:absolute;right:0;bottom:52px;max-width:220px;padding:8px;border:1px solid #c5221f;border-radius:6px;background:#fff;color:#c5221f;font:12px Arial;box-shadow:0 8px 24px rgba(0,0,0,.18)";
    let pinAction: HTMLButtonElement | undefined;
    for (const [label, type] of [
      ["复制标签页", "floating-ball/duplicate-tab"],
      ["固定 / 取消固定", "floating-ball/toggle-pin"],
      ["关闭标签页", "floating-ball/close-tab"],
      ["打开侧边栏", "floating-ball/open-side-panel"],
      ["一键分组", "floating-ball/smart-group-window"],
    ] as const) {
      const item = deps.document.createElement("button");
      item.type = "button";
      item.textContent = label;
      item.dataset.action = type;
      if (type === "floating-ball/toggle-pin") pinAction = item;
      item.addEventListener("click", () => {
        if (commandBusy) return;
        commandBusy = true;
        for (const button of Array.from(menu.querySelectorAll<HTMLButtonElement>("button"))) button.disabled = true;
        void Promise.resolve(deps.runtime.sendMessage({ type })).then((response) => {
          if (response?.ok) {
            menuOpen = false;
            menu.hidden = true;
            notice.hidden = true;
          } else {
            notice.textContent = response?.message ?? "操作失败";
            notice.hidden = false;
          }
        }).catch(() => {
          notice.textContent = "操作失败";
          notice.hidden = false;
        }).finally(() => {
          commandBusy = false;
          for (const button of Array.from(menu.querySelectorAll<HTMLButtonElement>("button"))) button.disabled = false;
        });
      });
      menu.append(item);
    }
    widget.append(menu, notice);
    shadow.append(widget);
    deps.document.documentElement.append(host);
    positionHost(settings);
    host.hidden = deps.document.fullscreenElement !== null;

    let searchOpen = false;
    let menuOpen = false;
    let selectedResult = -1;
    let searchResults: Array<{ title: string; url: string; source: "bookmark" | "history" }> = [];
    let commandBusy = false;
    let dragStart: { x: number; y: number; left: number; top: number } | undefined;
    let dragged = false;
    const toggleSearch = (): void => {
      searchOpen = !searchOpen;
      search.hidden = !searchOpen;
      menuOpen = false;
      menu.hidden = true;
      if (searchOpen) {
        selectedResult = -1;
        results.replaceChildren();
        input.focus();
        void runSearch("");
      } else {
        requestGeneration += 1;
      }
    };
    const runSearch = async (query: string): Promise<void> => {
      const generation = ++requestGeneration;
      const response = await deps.runtime.sendMessage({ type: "floating-ball/search", query });
      if (generation !== requestGeneration || !searchOpen) return;
      results.replaceChildren();
      if (!response.ok || !response.value) {
        results.textContent = response.ok ? "暂无记录" : response.message;
        return;
      }
      const items = Array.isArray(response.value) ? response.value : [];
      searchResults = items;
      selectedResult = -1;
      for (const [index, item] of searchResults.entries()) {
        const option = deps.document.createElement("button");
        option.type = "button";
        option.dataset.index = String(index);
        option.textContent = `${item.title || item.url} · ${item.source === "bookmark" ? "收藏夹" : "历史记录"}`;
        option.addEventListener("click", () => {
          void deps.runtime.sendMessage({ type: "floating-ball/open-search-result", url: item.url });
          searchOpen = false;
          search.hidden = true;
        });
        results.append(option);
      }
    };
    const onInput = (): void => {
      if (searchTimer !== undefined) deps.window.clearTimeout(searchTimer);
      searchTimer = deps.window.setTimeout(() => {
        searchTimer = undefined;
        void runSearch(input.value);
      }, 100);
    };
    const onClick = (): void => {
      if (!dragged) toggleSearch();
      dragged = false;
    };
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      searchOpen = false;
      search.hidden = true;
      menuOpen = !menuOpen;
      menu.hidden = !menuOpen;
      if (menuOpen && pinAction) {
        void Promise.resolve(deps.runtime.sendMessage({ type: "floating-ball/get-tab-state" })).then((response) => {
          if (response?.ok && response.value && typeof response.value === "object") {
            const state = response.value as { pinned?: unknown };
            pinAction!.textContent = state.pinned ? "取消固定标签页" : "固定标签页";
          }
        });
      }
    };
    const closeSurfaces = (): void => {
      if (!searchOpen && !menuOpen) return;
      requestGeneration += 1;
      searchOpen = false;
      menuOpen = false;
      search.hidden = true;
      menu.hidden = true;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeSurfaces();
        ball.focus();
        return;
      }
      if (!searchOpen || searchResults.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        selectedResult = (selectedResult + step + searchResults.length) % searchResults.length;
        const options = Array.from(results.querySelectorAll<HTMLButtonElement>("button"));
        options.forEach((option, index) => { option.dataset.selected = String(index === selectedResult); });
        options[selectedResult]?.focus();
        return;
      }
      if (event.key === "Enter" && selectedResult >= 0) {
        event.preventDefault();
        const selected = searchResults[selectedResult];
        if (!selected) return;
        void deps.runtime.sendMessage({ type: "floating-ball/open-search-result", url: selected.url });
        closeSurfaces();
      }
    };
    const onDocumentPointerDown = (event: PointerEvent): void => {
      if (!host?.contains(event.target as Node)) closeSurfaces();
    };
    const onResize = (): void => {
      if (currentSettings) positionHost(currentSettings);
    };
    const onPointerDown = (event: PointerEvent): void => {
      dragStart = { x: event.clientX, y: event.clientY, left: host!.offsetLeft, top: host!.offsetTop };
      dragged = false;
      ball.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!dragStart) return;
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      if (!exceedsDragThreshold(dx, dy)) return;
      dragged = true;
      host!.style.left = `${Math.max(0, dragStart.left + dx)}px`;
      host!.style.top = `${Math.max(0, dragStart.top + dy)}px`;
      host!.style.right = "auto";
      host!.style.bottom = "auto";
    };
    const onPointerUp = (): void => {
      if (dragStart && dragged) {
        void deps.settings.savePosition(toRatioPosition(
          { left: host!.offsetLeft, top: host!.offsetTop },
          { width: deps.window.innerWidth, height: deps.window.innerHeight },
        ));
      }
      dragStart = undefined;
    };
    const onFullscreen = (): void => {
      host!.hidden = deps.document.fullscreenElement !== null;
    };
    ball.addEventListener("click", onClick);
    ball.addEventListener("contextmenu", onContextMenu);
    ball.addEventListener("pointerdown", onPointerDown);
    ball.addEventListener("pointermove", onPointerMove);
    ball.addEventListener("pointerup", onPointerUp);
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeyDown);
    deps.document.addEventListener("fullscreenchange", onFullscreen);
    deps.document.addEventListener("pointerdown", onDocumentPointerDown, true);
    deps.window.addEventListener("resize", onResize);
    cleanup = () => {
      requestGeneration += 1;
      ball.removeEventListener("click", onClick);
      ball.removeEventListener("contextmenu", onContextMenu);
      ball.removeEventListener("pointerdown", onPointerDown);
      ball.removeEventListener("pointermove", onPointerMove);
      ball.removeEventListener("pointerup", onPointerUp);
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeyDown);
      deps.document.removeEventListener("fullscreenchange", onFullscreen);
      deps.document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      deps.window.removeEventListener("resize", onResize);
      if (searchTimer !== undefined) deps.window.clearTimeout(searchTimer);
      searchTimer = undefined;
    };
  }

  function positionHost(settings: FloatingBallSettings): void {
    if (!host) return;
    const point = clampBallPosition(settings.position, {
      width: deps.window.innerWidth,
      height: deps.window.innerHeight,
    });
    host.style.left = `${point.left}px`;
    host.style.top = `${point.top}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  }

  function remove(): void {
    cleanup?.();
    cleanup = undefined;
    host?.remove();
    deps.document.querySelector<HTMLElement>("[data-sidetab-floating-ball-host]")?.remove();
    host = undefined;
  }

  return { applySettings, destroy };
}

function createStyle(document: Document): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `:host{all:initial}.widget{position:absolute;right:0;bottom:0;width:44px;height:44px}.search{position:absolute;right:52px;bottom:0;width:300px;padding:8px;border:1px solid #d9dee6;border-radius:8px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18)}.search[hidden],.menu[hidden]{display:none}.search input{box-sizing:border-box;width:100%;height:40px;border:2px solid #1a73e8;border-radius:20px;padding:0 12px;font:13px Arial}.results{max-height:240px;overflow:auto;margin-bottom:8px}.results button,.menu button{display:block;width:100%;padding:8px;border:0;background:#fff;text-align:left;font:12px Arial}.results button:hover,.menu button:hover{background:#eef4ff}.menu{position:absolute;right:0;bottom:52px;width:180px;padding:4px;border:1px solid #d9dee6;border-radius:8px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18)}.widget>button{width:44px;height:44px;border:0;border-radius:50%;background:#1769e0;box-shadow:0 5px 16px rgba(23,105,224,.36);color:#fff;cursor:pointer}.ball-icon{display:block;width:20px;height:20px;margin:auto;border:2px solid currentColor;border-radius:4px;position:relative}.ball-icon:before{content:"";position:absolute;left:5px;top:0;bottom:0;border-left:2px solid currentColor}.ball-icon:after{content:"";position:absolute;left:9px;right:2px;top:5px;height:2px;background:currentColor;box-shadow:0 5px 0 currentColor,0 10px 0 currentColor}`;
  return style;
}
