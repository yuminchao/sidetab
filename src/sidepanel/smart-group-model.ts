import {
  TAB_GROUP_COLORS,
  TAB_GROUP_ID_NONE,
  type TabGroupColor,
} from "./tab-group-model";
import type { TabViewModel } from "./tab-model";
import { getHttpHostname } from "./tab-url-model";

export type SmartGroupCategory = Readonly<{
  key: string;
  title: string;
  kind: "site" | "special";
}>;

export type SmartGroupOperation =
  | Readonly<{ kind: "reuse"; groupId: number; tabIds: readonly number[] }>
  | Readonly<{
      kind: "create";
      title: string;
      color: TabGroupColor;
      tabIds: readonly number[];
      role?: "other";
    }>;

export type SmartGroupPlan = Readonly<{
  windowId: number;
  operations: readonly SmartGroupOperation[];
}>;

type GroupMatch = {
  groupId: number;
  memberCount: number;
  earliestIndex: number;
};

type CategorySnapshot = {
  category: SmartGroupCategory;
  members: Array<{ id: number; groupId: number }>;
  candidateIds: number[];
  earliestCandidateIndex: number;
  matches: Map<number, GroupMatch>;
};

type WindowSnapshot = {
  categories: Map<string, CategorySnapshot>;
  groupsById: Map<number, chrome.tabGroups.TabGroup>;
  usedColors: Set<TabGroupColor>;
  groupCount: number;
};

type IndexedTab = Readonly<{
  tab: TabViewModel;
  index: number;
}>;

/**
 * 按智能分组支持的 URL 类型分类标签，固定标签不参与分类。
 */
export function classifySmartGroupTab(
  tab: TabViewModel,
): SmartGroupCategory | undefined {
  if (tab.pinned) return undefined;

  const hostname = getHttpHostname(tab.url);
  if (hostname) {
    return {
      key: `site:${hostname}`,
      title: hostname,
      kind: "site",
    };
  }

  try {
    const parsed = new URL(tab.url);
    if (parsed.protocol === "file:") {
      return { key: "special:file", title: "本地文件", kind: "special" };
    }
    if (parsed.protocol === "chrome:" && parsed.hostname === "settings") {
      return {
        key: "special:chrome-settings",
        title: "Chrome 设置",
        kind: "special",
      };
    }
    if (parsed.protocol === "chrome:") {
      return { key: "special:chrome", title: "Chrome 页面", kind: "special" };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * 基于当前标签成员建立分类和可复用分组索引。
 */
function buildWindowSnapshot(
  tabs: readonly TabViewModel[],
  groups: readonly chrome.tabGroups.TabGroup[],
  windowId: number,
): WindowSnapshot {
  const groupsById = new Map<number, chrome.tabGroups.TabGroup>();
  const usedColors = new Set<TabGroupColor>();
  let groupCount = 0;

  for (const group of groups) {
    if (group.windowId !== windowId) continue;
    groupsById.set(group.id, group);
    usedColors.add(group.color);
    groupCount += 1;
  }

  const categories = new Map<string, CategorySnapshot>();
  for (const { tab, index } of orderTabsByIndex(tabs)) {
    if (tab.windowId !== windowId) continue;
    const category = classifySmartGroupTab(tab);
    if (!category) continue;

    let snapshot = categories.get(category.key);
    if (!snapshot) {
      snapshot = {
        category,
        members: [],
        candidateIds: [],
        earliestCandidateIndex: Number.POSITIVE_INFINITY,
        matches: new Map(),
      };
      categories.set(category.key, snapshot);
    }
    if (tab.groupId === TAB_GROUP_ID_NONE || tab.groupId >= 0) {
      snapshot.members.push({ id: tab.id, groupId: tab.groupId });
    }

    if (tab.groupId === TAB_GROUP_ID_NONE) {
      snapshot.candidateIds.push(tab.id);
      snapshot.earliestCandidateIndex = Math.min(snapshot.earliestCandidateIndex, index);
    }

    if (groupsById.has(tab.groupId)) {
      const match = snapshot.matches.get(tab.groupId) ?? {
        groupId: tab.groupId,
        memberCount: 0,
        earliestIndex: index,
      };
      match.memberCount += 1;
      match.earliestIndex = Math.min(match.earliestIndex, index);
      snapshot.matches.set(tab.groupId, match);
    }
  }

  return { categories, groupsById, usedColors, groupCount };
}

/**
 * 使用固定趟数的稳定基数排序在线性时间内恢复标签顺序。
 * 排序空间只随标签数增长，不会按异常的巨大 index 分配数组。
 */
function orderTabsByIndex(tabs: readonly TabViewModel[]): IndexedTab[] {
  const indexedTabs: IndexedTab[] = [];
  for (const tab of tabs) {
    indexedTabs.push({ tab, index: tab.index });
  }
  return orderByIndex(indexedTabs, ({ index }) => index);
}

/**
 * 按整数索引稳定排序，非法索引保持输入顺序并置于合法索引之后。
 */
function orderByIndex<T>(values: readonly T[], keyOf: (value: T) => number): T[] {
  const negative: T[] = [];
  const nonNegative: T[] = [];
  const invalid: T[] = [];

  for (const value of values) {
    const index = keyOf(value);
    if (!Number.isSafeInteger(index)) invalid.push(value);
    else if (index < 0) negative.push(value);
    else nonNegative.push(value);
  }

  return [
    ...radixSortNonNegative(negative, (value) => -keyOf(value), true),
    ...radixSortNonNegative(nonNegative, keyOf),
    ...invalid,
  ];
}

/**
 * 对非负安全整数执行固定趟数稳定基数排序，空间复杂度为 O(n)。
 */
function radixSortNonNegative<T>(
  values: readonly T[],
  keyOf: (value: T) => number,
  descending = false,
): T[] {
  const radix = 2_048;
  let source = [...values];
  let target = new Array<T>(values.length);
  let place = 1;

  for (let pass = 0; pass < 5; pass += 1) {
    const counts = new Uint32Array(radix);
    for (const value of source) {
      const ascendingDigit = Math.floor(keyOf(value) / place) % radix;
      const digit = descending ? radix - 1 - ascendingDigit : ascendingDigit;
      counts[digit] = counts[digit]! + 1;
    }
    let offset = 0;
    for (let digit = 0; digit < radix; digit += 1) {
      const count = counts[digit]!;
      counts[digit] = offset;
      offset += count;
    }
    for (const value of source) {
      const ascendingDigit = Math.floor(keyOf(value) / place) % radix;
      const digit = descending ? radix - 1 - ascendingDigit : ascendingDigit;
      target[counts[digit]!] = value;
      counts[digit] = counts[digit]! + 1;
    }
    [source, target] = [target, source];
    place *= radix;
  }

  return source;
}

/**
 * 按成员数量和最早成员位置选择唯一复用组。
 */
function selectBestMatch(matches: ReadonlyMap<number, GroupMatch>): GroupMatch | undefined {
  let best: GroupMatch | undefined;
  for (const match of matches.values()) {
    if (
      !best
      || match.memberCount > best.memberCount
      || (
        match.memberCount === best.memberCount
        && match.earliestIndex < best.earliestIndex
      )
    ) {
      best = match;
    }
  }
  return best;
}

/**
 * 优先选择窗口未用色，并避免九色耗尽前与本批创建操作重复。
 */
function selectGroupColor(
  windowUsedColors: ReadonlySet<TabGroupColor>,
  batchSelectedColors: ReadonlySet<TabGroupColor>,
  existingGroupCount: number,
  createOrdinal: number,
): TabGroupColor {
  const unusedWindowColor = TAB_GROUP_COLORS.find((color) => (
    !windowUsedColors.has(color) && !batchSelectedColors.has(color)
  ));
  if (unusedWindowColor) return unusedWindowColor;

  const start = (existingGroupCount + createOrdinal) % TAB_GROUP_COLORS.length;
  if (batchSelectedColors.size < TAB_GROUP_COLORS.length) {
    for (let offset = 0; offset < TAB_GROUP_COLORS.length; offset += 1) {
      const color = TAB_GROUP_COLORS[(start + offset) % TAB_GROUP_COLORS.length]!;
      if (!batchSelectedColors.has(color)) return color;
    }
  }
  return TAB_GROUP_COLORS[start]!;
}

/**
 * 为右键目标生成单个同分类快速分组操作。
 */
export function createQuickGroupPlan(
  tabs: readonly TabViewModel[],
  groups: readonly chrome.tabGroups.TabGroup[],
  tabId: number,
): SmartGroupPlan | undefined {
  const target = tabs.find((tab) => tab.id === tabId);
  const targetCategory = target && classifySmartGroupTab(target);
  if (!target || !targetCategory) return undefined;

  const snapshot = buildWindowSnapshot(tabs, groups, target.windowId);
  const category = snapshot.categories.get(targetCategory.key);
  if (!category) return undefined;

  const bestMatch = selectBestMatch(category.matches);
  if (bestMatch) {
    const tabIds = category.members
      .filter((member) => member.groupId !== bestMatch.groupId)
      .map((member) => member.id);
    if (tabIds.length === 0) return undefined;
    return {
      windowId: target.windowId,
      operations: [{ kind: "reuse", groupId: bestMatch.groupId, tabIds }],
    };
  }

  const tabIds = category.members.map((member) => member.id);
  if (tabIds.length === 0) return undefined;

  return {
    windowId: target.windowId,
    operations: [{
      kind: "create",
      title: targetCategory.title,
      color: selectGroupColor(snapshot.usedColors, new Set(), snapshot.groupCount, 0),
      tabIds,
    }],
  };
}

/**
 * 为当前窗口生成按分类稳定排序的一键分组操作。
 */
export function createOneClickGroupPlan(
  tabs: readonly TabViewModel[],
  groups: readonly chrome.tabGroups.TabGroup[],
  otherGroupId?: number,
): SmartGroupPlan | undefined {
  const copiedTabs = [...tabs];
  const firstTab = copiedTabs[0];
  if (!firstTab) return undefined;

  const windowId = firstTab.windowId;
  const snapshot = buildWindowSnapshot(copiedTabs, groups, windowId);
  const pending: Array<
    | { earliestIndex: number; operation: SmartGroupOperation }
    | {
        earliestIndex: number;
        createOperation: (color: TabGroupColor) => SmartGroupOperation;
      }
  > = [];
  const otherTabIds: number[] = [];
  let otherEarliestIndex = Number.POSITIVE_INFINITY;

  for (const category of snapshot.categories.values()) {
    if (category.candidateIds.length === 0) continue;
    const bestMatch = selectBestMatch(category.matches);
    if (bestMatch) {
      pending.push({
        earliestIndex: category.earliestCandidateIndex,
        operation: {
          kind: "reuse",
          groupId: bestMatch.groupId,
          tabIds: category.candidateIds,
        },
      });
      continue;
    }

    if (category.category.kind === "site" && category.candidateIds.length === 1) {
      otherTabIds.push(category.candidateIds[0]!);
      otherEarliestIndex = Math.min(otherEarliestIndex, category.earliestCandidateIndex);
      continue;
    }

    pending.push({
      earliestIndex: category.earliestCandidateIndex,
      createOperation: (color) => ({
        kind: "create",
        title: category.category.title,
        color,
        tabIds: category.candidateIds,
      }),
    });
  }

  if (otherTabIds.length > 0) {
    const validOtherGroup = otherGroupId === undefined
      ? undefined
      : snapshot.groupsById.get(otherGroupId);
    pending.push(validOtherGroup
      ? {
          earliestIndex: otherEarliestIndex,
          operation: { kind: "reuse", groupId: validOtherGroup.id, tabIds: otherTabIds },
        }
      : {
          earliestIndex: otherEarliestIndex,
          createOperation: (color) => ({
            kind: "create",
            title: "其他",
            color,
            tabIds: otherTabIds,
            role: "other",
          }),
        });
  }

  if (pending.length === 0) return undefined;
  const orderedPending = orderByIndex(pending, ({ earliestIndex }) => earliestIndex);

  const operations: SmartGroupOperation[] = [];
  const batchSelectedColors = new Set<TabGroupColor>();
  let createOrdinal = 0;
  for (const item of orderedPending) {
    if ("operation" in item) {
      operations.push(item.operation);
      continue;
    }
    const color = selectGroupColor(
      snapshot.usedColors,
      batchSelectedColors,
      snapshot.groupCount,
      createOrdinal,
    );
    batchSelectedColors.add(color);
    createOrdinal += 1;
    operations.push(item.createOperation(color));
  }

  return { windowId, operations };
}
