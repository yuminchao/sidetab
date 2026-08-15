export type TabGroupRenameDialogElements = {
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  name: HTMLInputElement;
  error: HTMLElement;
  cancel: HTMLButtonElement;
  save: HTMLButtonElement;
};

export type TabGroupRenameDialogCallbacks = {
  onSave(input: { groupId: number; title: string }): Promise<void>;
};

export type TabGroupRenameDialog = {
  open(groupId: number, title: string): void;
  close(): void;
  closeForGroup(groupId: number): void;
  destroy(): void;
};

type RenameSession = {
  generation: number;
  groupId: number;
  saving: boolean;
};

export function createTabGroupRenameDialog(
  elements: TabGroupRenameDialogElements,
  callbacks: TabGroupRenameDialogCallbacks,
): TabGroupRenameDialog {
  let active = true;
  let generation = 0;
  let session: RenameSession | undefined;

  const invalidateSession = (): void => {
    generation += 1;
    session = undefined;
  };

  const isCurrentSession = (candidate: RenameSession): boolean =>
    active && session === candidate && candidate.generation === generation;

  const setBusy = (busy: boolean): void => {
    elements.name.disabled = busy;
    elements.cancel.disabled = busy;
    elements.save.disabled = busy;
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
    setError("");
  };

  const onSubmit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const submittedSession = session;
    if (!submittedSession || submittedSession.saving) return;

    submittedSession.saving = true;
    setBusy(true);
    setError("");

    try {
      await callbacks.onSave({
        groupId: submittedSession.groupId,
        title: elements.name.value.trim(),
      });
      if (!isCurrentSession(submittedSession)) return;
      submittedSession.saving = false;
      close();
    } catch (error) {
      if (!isCurrentSession(submittedSession)) return;
      submittedSession.saving = false;
      setBusy(false);
      setError(error instanceof Error ? error.message : "无法重命名标签组");
    }
  };

  elements.form.addEventListener("submit", onSubmit);
  elements.cancel.addEventListener("click", onCancelClick);
  elements.dialog.addEventListener("cancel", onDialogCancel);
  elements.dialog.addEventListener("close", onDialogClose);

  return {
    open(groupId, title) {
      if (!active) return;
      invalidateSession();
      session = { generation, groupId, saving: false };
      elements.name.value = title;
      setBusy(false);
      setError("");
      if (!elements.dialog.open) {
        elements.dialog.showModal();
      }
      elements.name.select();
    },

    close,

    closeForGroup(groupId) {
      if (session?.groupId === groupId) {
        close();
      }
    },

    destroy() {
      if (!active) return;
      if (elements.dialog.open) {
        elements.dialog.close();
      }
      active = false;
      invalidateSession();
      setBusy(false);
      setError("");
      elements.form.removeEventListener("submit", onSubmit);
      elements.cancel.removeEventListener("click", onCancelClick);
      elements.dialog.removeEventListener("cancel", onDialogCancel);
      elements.dialog.removeEventListener("close", onDialogClose);
    },
  };
}
