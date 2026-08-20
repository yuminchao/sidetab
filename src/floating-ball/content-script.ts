import { createFloatingBallController, type FloatingBallController } from "./controller";
import {
  FLOATING_BALL_ENABLED_KEY,
  FLOATING_BALL_POSITION_KEY,
  createFloatingBallSettingsStore,
  type FloatingBallSettingsStore,
} from "./settings";
import type { FloatingBallResponse } from "./messages";

type ContentRuntime = {
  sendMessage(message: unknown): Promise<FloatingBallResponse<unknown>>;
};

type ContentStorage = {
  onChanged: { addListener(listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void): void; removeListener(listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void): void };
};

export type ContentScriptDependencies = {
  document: Document;
  window: Window;
  settingsStore: FloatingBallSettingsStore;
  runtime: ContentRuntime;
  storage: ContentStorage;
};

let activeController: FloatingBallController | undefined;
let activeListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined;

type FloatingBallGlobal = typeof globalThis & {
  __sideTabFloatingBallController?: FloatingBallController;
};

/**
 * 启动或替换当前页面的悬浮球内容脚本实例。
 *
 * @param deps 页面依赖与 Chrome API 适配器。
 * @returns 初始设置应用完成时解决的 Promise。
 */
export async function startFloatingBallContentScript(deps: ContentScriptDependencies): Promise<void> {
  activeListener && deps.storage.onChanged.removeListener(activeListener);
  const globalScope = globalThis as FloatingBallGlobal;
  globalScope.__sideTabFloatingBallController?.destroy();
  activeController?.destroy();
  const controller = createFloatingBallController({
    document: deps.document,
    window: deps.window,
    settings: deps.settingsStore,
    runtime: deps.runtime,
  });
  activeController = controller;
  globalScope.__sideTabFloatingBallController = controller;
  await controller.applySettings(await deps.settingsStore.load());
  activeListener = (changes, areaName) => {
    if (areaName !== "local") return;
    if (!(FLOATING_BALL_ENABLED_KEY in changes) && !(FLOATING_BALL_POSITION_KEY in changes)) return;
    void deps.settingsStore.load().then((settings) => controller.applySettings(settings));
  };
  deps.storage.onChanged.addListener(activeListener);
}

if (typeof chrome !== "undefined" && typeof document !== "undefined") {
  void startFloatingBallContentScript({
    document,
    window,
    settingsStore: createFloatingBallSettingsStore(chrome.storage.local),
    runtime: chrome.runtime,
    storage: chrome.storage,
  });
}
