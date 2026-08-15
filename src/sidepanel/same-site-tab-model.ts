import type { TabViewModel } from "./tab-model";
import { getHttpHostname } from "./tab-url-model";

/** 保留关闭同网站标签调用方的兼容导出。 */
export { getHttpHostname } from "./tab-url-model";

/**
 * 返回目标标签之外、同窗口且未固定的同主机标签 ID。
 */
export function getOtherSameSiteTabIds(tabs: readonly TabViewModel[], tabId: number): number[] {
  const target = tabs.find((tab) => tab.id === tabId);
  const hostname = target && getHttpHostname(target.url);

  if (!target || !hostname) {
    return [];
  }

  return tabs.flatMap((tab) => (
    tab.id !== target.id
    && tab.windowId === target.windowId
    && !tab.pinned
    && getHttpHostname(tab.url) === hostname
      ? [tab.id]
      : []
  ));
}
