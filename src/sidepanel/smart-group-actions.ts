import type {
  SmartGroupOperation,
  SmartGroupPlan,
} from "./smart-group-model";
import {
  PartialTabGroupCreationError,
  assertValidTabGroupId,
  updateCreatedTabGroup,
} from "./tab-group-actions";

export type SmartGroupExecutionDependencies = {
  tabs: Pick<typeof chrome.tabs, "group">;
  tabGroups: Pick<typeof chrome.tabGroups, "update">;
  validate(operation: SmartGroupOperation): boolean;
  onOtherGroupCreated(groupId: number): Promise<void>;
};

export class SmartGroupExecutionError extends Error {
  readonly partial: boolean;

  constructor(
    message: string,
    readonly completed: number,
    readonly operation: SmartGroupOperation,
    currentOperationChangedChrome: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SmartGroupExecutionError";
    this.partial = completed > 0 || currentOperationChangedChrome;
  }
}

function executionError(
  message: string,
  completed: number,
  operation: SmartGroupOperation,
  currentOperationChangedChrome: boolean,
  cause?: unknown,
): SmartGroupExecutionError {
  const options = cause === undefined ? undefined : { cause };
  return new SmartGroupExecutionError(
    message,
    completed,
    operation,
    currentOperationChangedChrome,
    options,
  );
}

/**
 * 严格按计划顺序调用 Chrome API；失败后停止，且不回滚已经完成的外部操作。
 */
export async function executeSmartGroupPlan(
  plan: SmartGroupPlan,
  deps: SmartGroupExecutionDependencies,
): Promise<void> {
  let completed = 0;

  for (const operation of plan.operations) {
    let valid: boolean;
    try {
      valid = deps.validate(operation);
    } catch (cause) {
      throw executionError("智能分组计划校验失败", completed, operation, false, cause);
    }
    if (!valid) {
      throw executionError("智能分组计划校验失败", completed, operation, false);
    }
    if (operation.tabIds.length === 0) {
      throw executionError("智能分组操作不包含标签页", completed, operation, false);
    }

    const tabIds = [...operation.tabIds] as [number, ...number[]];
    if (operation.kind === "reuse") {
      try {
        assertValidTabGroupId(operation.groupId);
        await deps.tabs.group({ tabIds, groupId: operation.groupId });
      } catch (cause) {
        throw executionError("无法执行智能分组", completed, operation, false, cause);
      }
      completed += 1;
      continue;
    }

    let groupId: number;
    try {
      groupId = await deps.tabs.group({ tabIds });
    } catch (cause) {
      throw executionError("无法创建智能分组", completed, operation, false, cause);
    }

    // group 成功后即已改变 Chrome；后续 metadata 或角色持久化失败都属于部分成功。
    try {
      assertValidTabGroupId(groupId);
      await updateCreatedTabGroup(deps.tabGroups, groupId, operation.title, operation.color);
      if (operation.role === "other") {
        await deps.onOtherGroupCreated(groupId);
      }
    } catch (error) {
      const cause = error instanceof PartialTabGroupCreationError
        ? error.cause
        : error;
      throw executionError("智能分组仅部分完成", completed, operation, true, cause);
    }

    completed += 1;
  }
}
