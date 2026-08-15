import { describe, expect, it, vi } from "vitest";
import {
  SmartGroupExecutionError,
  executeSmartGroupPlan,
} from "../src/sidepanel/smart-group-actions";
import type {
  SmartGroupOperation,
  SmartGroupPlan,
} from "../src/sidepanel/smart-group-model";

const reuse = (groupId: number, tabIds: readonly number[]): SmartGroupOperation => ({
  kind: "reuse",
  groupId,
  tabIds,
});

const create = (
  title: string,
  tabIds: readonly number[],
  role?: "other",
): SmartGroupOperation => ({ kind: "create", title, color: "blue", tabIds, role });

function createExecutor(plan: SmartGroupPlan) {
  const group = vi.fn().mockResolvedValue(7);
  const update = vi.fn().mockResolvedValue(undefined);
  const validate = vi.fn().mockReturnValue(true);
  const onOtherGroupCreated = vi.fn().mockResolvedValue(undefined);
  const execute = () => executeSmartGroupPlan(plan, {
    tabs: { group } as Pick<typeof chrome.tabs, "group">,
    tabGroups: { update } as Pick<typeof chrome.tabGroups, "update">,
    validate,
    onOtherGroupCreated,
  });

  return { execute, group, update, validate, onOtherGroupCreated };
}

describe("smart group actions", () => {
  it("reuses a group with exactly one copied tab ID array", async () => {
    const operation = reuse(9, [1, 2]);
    const plan = { windowId: 3, operations: [operation] };
    const { execute, group, update } = createExecutor(plan);

    await execute();

    expect(group).toHaveBeenCalledOnce();
    expect(group).toHaveBeenCalledWith({ tabIds: [1, 2], groupId: 9 });
    expect(group.mock.calls[0]?.[0].tabIds).not.toBe(operation.tabIds);
    expect(update).not.toHaveBeenCalled();
  });

  it("creates a group and then saves its metadata", async () => {
    const operation = create("Work", [3, 4]);
    const { execute, group, update } = createExecutor({ windowId: 3, operations: [operation] });

    await execute();

    expect(group).toHaveBeenCalledWith({ tabIds: [3, 4] });
    expect(update).toHaveBeenCalledWith(7, { title: "Work", color: "blue" });
    expect(group.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]!);
  });

  it("waits for each complete operation before starting the next", async () => {
    let finishFirst!: (groupId: number) => void;
    const first = new Promise<number>((resolve) => { finishFirst = resolve; });
    const plan = { windowId: 3, operations: [create("First", [1]), reuse(8, [2])] };
    const { execute, group, update } = createExecutor(plan);
    group.mockImplementationOnce(() => first).mockResolvedValueOnce(8);

    const pending = execute();
    await Promise.resolve();
    expect(group).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();

    finishFirst(7);
    await pending;
    expect(update).toHaveBeenCalledWith(7, { title: "First", color: "blue" });
    expect(group).toHaveBeenNthCalledWith(2, { tabIds: [2], groupId: 8 });
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(group.mock.invocationCallOrder[1]!);
  });

  it("waits for metadata update before starting the next operation", async () => {
    let finishUpdate!: () => void;
    const pendingUpdate = new Promise<void>((resolve) => { finishUpdate = resolve; });
    const plan = { windowId: 3, operations: [create("First", [1]), reuse(8, [2])] };
    const { execute, group, update } = createExecutor(plan);
    update.mockReturnValueOnce(pendingUpdate);

    const pending = execute();
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(group).toHaveBeenCalledTimes(1);

    finishUpdate();
    await pending;
    expect(group).toHaveBeenNthCalledWith(2, { tabIds: [2], groupId: 8 });
  });

  it("waits for the Other role callback before starting the next operation", async () => {
    let finishRoleSave!: () => void;
    const pendingRoleSave = new Promise<void>((resolve) => { finishRoleSave = resolve; });
    const plan = {
      windowId: 3,
      operations: [create("Other", [1], "other"), reuse(8, [2])],
    };
    const { execute, group, onOtherGroupCreated } = createExecutor(plan);
    onOtherGroupCreated.mockReturnValueOnce(pendingRoleSave);

    const pending = execute();
    await vi.waitFor(() => expect(onOtherGroupCreated).toHaveBeenCalledOnce());
    expect(group).toHaveBeenCalledTimes(1);

    finishRoleSave();
    await pending;
    expect(group).toHaveBeenNthCalledWith(2, { tabIds: [2], groupId: 8 });
  });

  it("stops before Chrome APIs when validation returns false", async () => {
    const operation = reuse(9, [1]);
    const { execute, group, update, validate } = createExecutor({
      windowId: 3,
      operations: [operation, reuse(10, [2])],
    });
    validate.mockReturnValue(false);

    await expect(execute()).rejects.toMatchObject({
      completed: 0,
      partial: false,
      operation,
      message: "智能分组计划校验失败",
    });
    expect(group).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("wraps a first-operation validation exception without calling Chrome", async () => {
    const cause = new Error("validation crashed");
    const operation = reuse(9, [1]);
    const { execute, group, update, validate } = createExecutor({
      windowId: 3,
      operations: [operation, reuse(10, [2])],
    });
    validate.mockImplementationOnce(() => { throw cause; });

    const pending = execute();
    await expect(pending).rejects.toBeInstanceOf(SmartGroupExecutionError);
    await expect(pending).rejects.toMatchObject({
      completed: 0,
      partial: false,
      operation,
      message: "智能分组计划校验失败",
      cause,
    });
    expect(validate).toHaveBeenCalledOnce();
    expect(group).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("wraps a later validation exception after completed work and stops subsequent APIs", async () => {
    const cause = new Error("validation crashed");
    const second = reuse(9, [2]);
    const { execute, group, validate } = createExecutor({
      windowId: 3,
      operations: [reuse(8, [1]), second, reuse(10, [3])],
    });
    validate.mockReturnValueOnce(true).mockImplementationOnce(() => { throw cause; });

    await expect(execute()).rejects.toMatchObject({
      completed: 1,
      partial: true,
      operation: second,
      message: "智能分组计划校验失败",
      cause,
    });
    expect(validate).toHaveBeenCalledTimes(2);
    expect(group).toHaveBeenCalledOnce();
    expect(group).toHaveBeenCalledWith({ tabIds: [1], groupId: 8 });
  });

  it("rejects empty tab IDs as an invalid operation", async () => {
    const operation = create("Empty", []);
    const { execute, group, update } = createExecutor({ windowId: 3, operations: [operation] });

    await expect(execute()).rejects.toMatchObject({
      completed: 0,
      partial: false,
      operation,
      message: "智能分组操作不包含标签页",
    });
    expect(group).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an invalid reuse group ID before calling Chrome", async () => {
    const operation = reuse(-1, [1]);
    const { execute, group } = createExecutor({ windowId: 3, operations: [operation] });

    await expect(execute()).rejects.toMatchObject({
      completed: 0,
      partial: false,
      operation,
    });
    expect(group).not.toHaveBeenCalled();
  });

  it("reports a first reuse failure as non-partial and preserves its cause", async () => {
    const cause = new Error("chrome failed");
    const operation = reuse(9, [1]);
    const { execute, group } = createExecutor({ windowId: 3, operations: [operation] });
    group.mockRejectedValueOnce(cause);

    const pending = execute();
    await expect(pending).rejects.toBeInstanceOf(SmartGroupExecutionError);
    await expect(pending).rejects.toMatchObject({ completed: 0, partial: false, operation, cause });
  });

  it("stops after a second-operation failure and reports one completed operation", async () => {
    const cause = new Error("second failed");
    const second = reuse(9, [2]);
    const { execute, group } = createExecutor({
      windowId: 3,
      operations: [reuse(8, [1]), second, reuse(10, [3])],
    });
    group.mockResolvedValueOnce(8).mockRejectedValueOnce(cause);

    await expect(execute()).rejects.toMatchObject({
      completed: 1,
      partial: true,
      operation: second,
      cause,
    });
    expect(group).toHaveBeenCalledTimes(2);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid group ID returned from create as partial: %s",
    async (groupId) => {
      const operation = create("Work", [1]);
      const { execute, group, update } = createExecutor({ windowId: 3, operations: [operation] });
      group.mockResolvedValueOnce(groupId);

      await expect(execute()).rejects.toMatchObject({ completed: 0, partial: true, operation });
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("reports metadata failure as partial and preserves the Chrome cause", async () => {
    const cause = new Error("metadata failed");
    const operation = create("Work", [1]);
    const { execute, update } = createExecutor({ windowId: 3, operations: [operation] });
    update.mockRejectedValueOnce(cause);

    await expect(execute()).rejects.toMatchObject({
      completed: 0,
      partial: true,
      operation,
      cause,
    });
  });

  it("saves Other only after its metadata update succeeds", async () => {
    const operation = create("Other", [1], "other");
    const { execute, group, update, onOtherGroupCreated } = createExecutor({
      windowId: 3,
      operations: [operation],
    });

    await execute();

    expect(onOtherGroupCreated).toHaveBeenCalledWith(7);
    expect(group.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]!);
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(
      onOtherGroupCreated.mock.invocationCallOrder[0]!,
    );
  });

  it("does not save Other when metadata update fails", async () => {
    const operation = create("Other", [1], "other");
    const { execute, update, onOtherGroupCreated } = createExecutor({
      windowId: 3,
      operations: [operation],
    });
    update.mockRejectedValueOnce(new Error("metadata failed"));

    await expect(execute()).rejects.toMatchObject({ partial: true, operation });
    expect(onOtherGroupCreated).not.toHaveBeenCalled();
  });

  it("reports an Other callback failure as partial without rolling Chrome changes back", async () => {
    const cause = new Error("store failed");
    const operation = create("Other", [1], "other");
    const { execute, group, update, onOtherGroupCreated } = createExecutor({
      windowId: 3,
      operations: [operation, reuse(9, [2])],
    });
    onOtherGroupCreated.mockRejectedValueOnce(cause);

    await expect(execute()).rejects.toMatchObject({
      completed: 0,
      partial: true,
      operation,
      cause,
    });
    expect(group).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledOnce();
  });
});
