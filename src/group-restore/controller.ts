import type { StorageArea } from "../sidepanel/shortcut-store";
import { createRestoreSettingsStore } from "./settings";

type Tab = { id?: number; windowId: number; groupId: number; index: number; url?: string; pendingUrl?: string; incognito: boolean };
type Group = { id: number; windowId: number; title?: string; color: string; collapsed: boolean };
type SavedGroup = { id?: number; reconciled?: boolean; title: string; color: chrome.tabGroups.Color; urls: string[] };
type Snapshot = { session: string; windowId: number; groups: SavedGroup[] };
type Session = { id: string; opened: number[] };
export type RestoreApi = {
  local: StorageArea;
  session: StorageArea;
  windows: { getAll(): Promise<Array<{ id?: number; incognito: boolean; type?: string }>> };
  tabs: {
    query(query: object): Promise<Tab[]>;
    create(properties: { windowId: number; url: string; active: boolean }): Promise<{ id?: number }>;
    group(options: { tabIds: [number, ...number[]] }): Promise<number>;
    remove(ids: number[]): Promise<void>;
  };
  tabGroups: {
    query(query: object): Promise<Group[]>;
    update(id: number, change: { title: string; color: chrome.tabGroups.Color; collapsed: boolean }): Promise<unknown>;
  };
};
const SNAPSHOTS_KEY = "groupRestoreSnapshots";
const SESSION_KEY = "groupRestoreSession";
const colors = new Set(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]);

function restorableUrl(url: string): boolean {
  try { return ["http:", "https:"].includes(new URL(url).protocol); } catch { return false; }
}

function validSnapshots(raw: unknown): Snapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Snapshot =>
    item && typeof item.session === "string" && Number.isInteger(item.windowId)
    && Array.isArray(item.groups) && item.groups.every((group: SavedGroup) =>
      group && typeof group.title === "string" && colors.has(group.color)
      && Array.isArray(group.urls) && group.urls.length > 0
      && group.urls.every((url) => typeof url === "string" && restorableUrl(url))));
}

function describeGroup(group: Group, tabs: Tab[]): SavedGroup {
  return {
    id: group.id,
    title: group.title ?? "",
    color: group.color as chrome.tabGroups.Color,
    urls: tabs.filter((tab) => tab.groupId === group.id && !tab.incognito)
      .sort((a, b) => a.index - b.index)
      .map((tab) => tab.pendingUrl ?? tab.url ?? "").filter(restorableUrl),
  };
}

function groupSignature(group: SavedGroup): string {
  return JSON.stringify([group.title, group.color, group.urls]);
}

/**
 * 串行执行快照与恢复，避免多个侧边栏同时恢复同一份记录。
 *
 * Args:
 *   api: Chrome 标签、分组、窗口和存储接口。
 * Returns:
 *   打开侧边栏、保存快照和标记关闭窗口的控制器。
 */
export function createGroupRestore(api: RestoreApi) {
  let queue = Promise.resolve();
  const closing = new Set<number>();
  let recoveryFailed = false;
  const settingsStore = createRestoreSettingsStore(api.local);
  const serial = (operation: () => Promise<void>): Promise<void> => {
    const task = queue.then(operation);
    queue = task.catch(() => undefined);
    return task;
  };
  const loadSession = async (): Promise<Session> => {
    const raw = (await api.session.get(SESSION_KEY))[SESSION_KEY] as Session | undefined;
    if (raw && typeof raw.id === "string" && Array.isArray(raw.opened)) return raw;
    const session = { id: crypto.randomUUID(), opened: [] };
    await api.session.set({ [SESSION_KEY]: session });
    return session;
  };
  const read = async () => {
    const [session, stored, windows, tabs, groups] = await Promise.all([
      loadSession(), api.local.get(SNAPSHOTS_KEY), api.windows.getAll(), api.tabs.query({}), api.tabGroups.query({}),
    ]);
    return { session, snapshots: validSnapshots(stored[SNAPSHOTS_KEY]), windows, tabs, groups };
  };

  /**
   * 保存仍打开的普通窗口；窗口关闭过程中的空快照不得覆盖关闭前记录。
   *
   * Returns:
   *   保存完成的 Promise。
   * Raises:
   *   Chrome 查询或本地存储失败。
   */
  const capture = async (): Promise<void> => {
    if (recoveryFailed || !(await settingsStore.load()).enabled) return;
    const state = await read();
    // Chrome 先于侧边栏恢复的分组接管旧快照；同会话 ID 防止连续事件重复消费同名分组。
    const tracked = new Set(state.snapshots.filter((saved) => saved.session === state.session.id)
      .flatMap((saved) => saved.groups.filter((group) => group.reconciled).map((group) => group.id)));
    const capturableWindows = new Set(state.windows.filter((window) =>
      !window.incognito && window.type === "normal" && window.id !== undefined && !closing.has(window.id))
      .map((window) => window.id));
    for (const group of state.groups) {
      if (tracked.has(group.id) || !capturableWindows.has(group.windowId)) continue;
      const signature = groupSignature(describeGroup(group, state.tabs));
      for (const snapshot of state.snapshots) {
        if (snapshot.session === state.session.id) continue;
        const index = snapshot.groups.findIndex((saved) => groupSignature(saved) === signature);
        if (index < 0) continue;
        snapshot.groups.splice(index, 1);
        tracked.add(group.id);
        break;
      }
    }
    for (const window of state.windows) {
      if (window.id === undefined || window.incognito || window.type !== "normal" || closing.has(window.id)) continue;
      state.snapshots = state.snapshots.filter((saved) => saved.session !== state.session.id || saved.windowId !== window.id);
      state.snapshots.push({
        session: state.session.id, windowId: window.id,
        groups: state.groups.filter((group) => group.windowId === window.id)
          .map((group) => ({ ...describeGroup(group, state.tabs), reconciled: tracked.has(group.id) }))
          .filter((group) => group.urls.length > 0),
      });
    }
    await api.local.set({ [SNAPSHOTS_KEY]: state.snapshots });
  };

  return {
    windowClosing(windowId: number): void { closing.add(windowId); },
    capture: () => serial(() => capture()),
    settingsSaved: (_windowId: number) => serial(async () => {
      await capture();
      const session = await loadSession();
      await api.session.set({ [SESSION_KEY]: { ...session, opened: [] } });
    }),
    open: (windowId: number) => serial(async () => {
      const settings = await settingsStore.load();
      if (!settings.enabled) return;
      const state = await read();
      const target = state.windows.find((window) => window.id === windowId);
      if (!target || target.incognito || target.type !== "normal") return;
      if (state.session.opened.includes(windowId)) { await capture(); return; }
      const liveWindows = new Set(state.windows.map((window) => window.id));
      const pending = state.snapshots.filter((saved) =>
        saved.session !== state.session.id || !liveWindows.has(saved.windowId));
      const candidates = state.groups.map((group) => ({ group, saved: describeGroup(group, state.tabs) }));
      // 同一会话中仍打开窗口的独立分组不能消费已关闭窗口的同名快照。
      const reserved = new Set<number>();
      for (const snapshot of state.snapshots.filter((saved) => saved.session === state.session.id && liveWindows.has(saved.windowId))) {
        for (const saved of snapshot.groups) {
          const candidate = candidates.find((item) => item.group.windowId === snapshot.windowId
            && !reserved.has(item.group.id) && groupSignature(item.saved) === groupSignature(saved));
          if (candidate) reserved.add(candidate.group.id);
        }
      }
      const created: number[] = [];
      try {
        for (const { saved, session } of pending.flatMap((snapshot) => snapshot.groups.map((saved) => ({ saved, session: snapshot.session })))) {
          const match = candidates.findIndex((candidate) =>
            (session !== state.session.id || !reserved.has(candidate.group.id))
            && groupSignature(candidate.saved) === groupSignature(saved));
          if (match >= 0) {
            const [existing] = candidates.splice(match, 1);
            if (existing!.group.windowId === windowId) {
              await api.tabGroups.update(existing!.group.id, { title: saved.title, color: saved.color, collapsed: settings.collapsed });
            }
            continue;
          }
          const tabIds: number[] = [];
          for (const url of saved.urls) {
            const tab = await api.tabs.create({ windowId, url, active: false });
            if (tab.id === undefined) throw new Error("无法取得恢复标签的 ID");
            created.push(tab.id);
            tabIds.push(tab.id);
          }
          const groupId = await api.tabs.group({ tabIds: tabIds as [number, ...number[]] });
          await api.tabGroups.update(groupId, { title: saved.title, color: saved.color, collapsed: settings.collapsed });
        }
        const remaining = state.snapshots.filter((saved) => !pending.includes(saved));
        // 先持久化恢复结果，再确认本窗口已恢复，后台重启后仍可通过分组匹配去重。
        const [tabs, groups, windows] = await Promise.all([api.tabs.query({}), api.tabGroups.query({}), api.windows.getAll()]);
        let snapshots = remaining;
        for (const window of windows) {
          if (window.id === undefined || window.incognito || window.type !== "normal" || closing.has(window.id)) continue;
          snapshots = snapshots.filter((saved) => saved.session !== state.session.id || saved.windowId !== window.id);
          snapshots.push({ session: state.session.id, windowId: window.id, groups: groups.filter((group) => group.windowId === window.id)
            .map((group) => ({ ...describeGroup(group, tabs), reconciled: true })).filter((group) => group.urls.length > 0) });
        }
        for (const group of groups.filter((group) => group.windowId === windowId)) {
          await api.tabGroups.update(group.id, {
            title: group.title ?? "", color: group.color as chrome.tabGroups.Color, collapsed: settings.collapsed,
          });
        }
        await api.local.set({ [SNAPSHOTS_KEY]: snapshots });
        await api.session.set({ [SESSION_KEY]: { ...state.session, opened: [...state.session.opened, windowId] } });
        recoveryFailed = false;
      } catch (error) {
        recoveryFailed = true;
        if (created.length) await api.tabs.remove(created);
        await api.local.set({ [SNAPSHOTS_KEY]: state.snapshots });
        throw error;
      }
    }),
  };
}
