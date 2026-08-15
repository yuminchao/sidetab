import { isValidTabGroupId, TAB_GROUP_COLORS, type TabGroupColor } from "./tab-group-model";

export type TabGroupDraft = {
  tabId: number;
  windowId: number;
  title: string;
  color: TabGroupColor;
  createdGroupId?: number;
};

export type TabGroupDialogElements = {
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  name: HTMLInputElement;
  colors: readonly HTMLInputElement[];
  error: HTMLElement;
  cancel: HTMLButtonElement;
  create: HTMLButtonElement;
};

export type TabGroupDialogCallbacks = {
  onCreate(draft: TabGroupDraft): Promise<number>;
  onUpdateCreated(draft: TabGroupDraft): Promise<void>;
};

export type TabGroupDialog = {
  open(tabId: number, windowId: number): void;
  close(): void;
  destroy(): void;
};

type DialogSession = {
  generation: number;
  draft: TabGroupDraft;
  saving: boolean;
};

export function createTabGroupDialog(
  elements: TabGroupDialogElements,
  callbacks: TabGroupDialogCallbacks,
): TabGroupDialog {
  let active = true;
  let generation = 0;
  let session: DialogSession | undefined;

  const invalidateSession = (): void => {
    generation += 1;
    session = undefined;
  };

  const isCurrentSession = (candidate: DialogSession): boolean =>
    active && session === candidate && candidate.generation === generation;

  const setBusy = (busy: boolean): void => {
    elements.name.disabled = busy;
    elements.cancel.disabled = busy;
    elements.create.disabled = busy;
    for (const color of elements.colors) {
      color.disabled = busy;
    }
  };

  const setError = (message: string): void => {
    elements.error.textContent = message;
  };

  const close = (): void => {
    if (!active) return;
    invalidateSession();
    setBusy(false);
    setError("");
    if (elements.dialog.open) {
      elements.dialog.close();
    }
  };

  const syncDraft = (draft: TabGroupDraft): void => {
    draft.title = elements.name.value;
    const selected = elements.colors.find((input) => input.checked)?.value;
    draft.color = TAB_GROUP_COLORS.includes(selected as TabGroupColor)
      ? selected as TabGroupColor
      : "grey";
  };

  const onCancelClick = (event: MouseEvent): void => {
    event.preventDefault();
    if (session?.saving) return;
    close();
  };

  const onDialogCancel = (event: Event): void => {
    event.preventDefault();
    if (session?.saving) return;
    close();
  };

  const onDialogClose = (): void => {
    invalidateSession();
    setBusy(false);
  };

  const onSubmit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const submittedSession = session;
    if (!submittedSession || submittedSession.saving) return;

    syncDraft(submittedSession.draft);
    submittedSession.saving = true;
    setBusy(true);
    setError("");
    const submittedDraft = { ...submittedSession.draft };

    try {
      if (submittedDraft.createdGroupId === undefined) {
        await callbacks.onCreate(submittedDraft);
      } else {
        await callbacks.onUpdateCreated(submittedDraft);
      }
      if (!isCurrentSession(submittedSession)) return;
      submittedSession.saving = false;
      close();
    } catch (error) {
      if (!isCurrentSession(submittedSession)) return;
      const createdGroupId = getPartialGroupId(error);
      if (createdGroupId !== undefined) {
        submittedSession.draft.createdGroupId = createdGroupId;
      }
      submittedSession.saving = false;
      setBusy(false);
      setError(error instanceof Error ? error.message : "无法创建标签组");
    }
  };

  elements.form.addEventListener("submit", onSubmit);
  elements.cancel.addEventListener("click", onCancelClick);
  elements.dialog.addEventListener("cancel", onDialogCancel);
  elements.dialog.addEventListener("close", onDialogClose);

  return {
    open(tabId, windowId) {
      if (!active) return;
      invalidateSession();
      session = {
        generation,
        draft: { tabId, windowId, title: "", color: "grey" },
        saving: false,
      };
      elements.name.value = "";
      for (const color of elements.colors) {
        color.checked = color.value === "grey";
      }
      setBusy(false);
      setError("");
      if (!elements.dialog.open) {
        elements.dialog.showModal();
      }
    },

    close,

    destroy() {
      active = false;
      invalidateSession();
      elements.form.removeEventListener("submit", onSubmit);
      elements.cancel.removeEventListener("click", onCancelClick);
      elements.dialog.removeEventListener("cancel", onDialogCancel);
      elements.dialog.removeEventListener("close", onDialogClose);
    },
  };
}

function getPartialGroupId(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("partial" in error) || !("groupId" in error)) {
    return undefined;
  }
  return error.partial === true && isValidTabGroupId(error.groupId)
    ? error.groupId
    : undefined;
}
