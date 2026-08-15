import { isValidTabGroupId } from "./tab-group-model";
import type { StorageArea } from "./shortcut-store";

export interface SmartGroupSessionState {
  otherGroupId?: number;
}

export interface SmartGroupSessionStore {
  /** 读取指定窗口记录的系统 Other 分组角色，数据不可用时返回空状态。 */
  load(windowId: number): Promise<SmartGroupSessionState>;

  /** 保存指定窗口由扩展创建的系统 Other 分组 ID。 */
  saveOtherGroup(windowId: number, groupId: number): Promise<void>;

  /** 清除指定窗口记录的系统 Other 分组角色。 */
  clearOtherGroup(windowId: number): Promise<void>;
}

const keyForWindow = (windowId: number): string => `smartGroupSession:${windowId}`;

export function createSmartGroupSessionStore(
  storage: StorageArea,
): SmartGroupSessionStore {
  let writeQueue = Promise.resolve();

  // 将外部 session storage 写入接到同一队列，确保后发状态不会先于旧状态落盘。
  const enqueueWrite = (items: Record<string, unknown>): Promise<void> => {
    const operation = writeQueue
      .catch(() => undefined)
      .then(() => storage.set(items));
    writeQueue = operation;
    return operation;
  };

  return {
    // 外部 storage 读取失败或内容失效时降级为空状态，避免阻塞侧边栏初始化。
    async load(windowId: number): Promise<SmartGroupSessionState> {
      if (!isValidWindowId(windowId)) return {};

      const key = keyForWindow(windowId);
      try {
        const stored = await storage.get(key);
        if (!Object.hasOwn(stored, key)) return {};
        const value = stored[key];
        if (
          !isRecord(value)
          || !Object.hasOwn(value, "otherGroupId")
          || !isValidTabGroupId(value.otherGroupId)
        ) return {};
        return { otherGroupId: value.otherGroupId };
      } catch {
        return {};
      }
    },

    async saveOtherGroup(windowId: number, groupId: number): Promise<void> {
      assertValidWindowId(windowId);
      if (!isValidTabGroupId(groupId)) {
        throw new Error("无效的标签组 ID");
      }
      await enqueueWrite({
        [keyForWindow(windowId)]: { otherGroupId: groupId },
      });
    },

    async clearOtherGroup(windowId: number): Promise<void> {
      assertValidWindowId(windowId);
      await enqueueWrite({ [keyForWindow(windowId)]: {} });
    },
  };
}

function assertValidWindowId(windowId: number): void {
  if (!isValidWindowId(windowId)) {
    throw new Error("无效的窗口 ID");
  }
}

function isValidWindowId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
