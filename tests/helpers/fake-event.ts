export class FakeEvent<Listener extends (...args: never[]) => void> {
  private readonly listeners = new Set<Listener>();

  readonly added: Listener[] = [];
  readonly removed: Listener[] = [];

  addListener(listener: Listener): void {
    this.added.push(listener);
    this.listeners.add(listener);
  }

  removeListener(listener: Listener): void {
    this.removed.push(listener);
    this.listeners.delete(listener);
  }

  emit(...args: Parameters<Listener>): void {
    for (const listener of this.listeners) {
      listener(...args);
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
