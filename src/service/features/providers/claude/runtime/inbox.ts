/**
 * An async iterable fed while it's read: the prompt stream of a turn in
 * streaming input mode, so messages can follow the first while it runs.
 */
export class Inbox<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private wake?: () => void;
  private ended = false;

  push(item: T) {
    this.items.push(item);
    this.wake?.();
  }

  /** Ends the stream once the items already pushed are read. */
  end() {
    this.ended = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    for (;;) {
      while (this.items.length) yield this.items.shift()!;
      if (this.ended) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
  }
}
