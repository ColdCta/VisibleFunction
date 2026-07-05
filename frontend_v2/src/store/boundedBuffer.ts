export class BoundedBuffer<T> {
  private values: T[] = [];
  private start = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("capacity must be a positive integer");
    }
  }

  get size(): number {
    return this.values.length - this.start;
  }

  push(value: T): T | undefined {
    this.values.push(value);
    if (this.size <= this.capacity) return undefined;
    const dropped = this.values[this.start++];
    this.compact();
    return dropped;
  }

  drain(): T[] {
    if (this.size === 0) return [];
    const result = this.values.slice(this.start);
    this.clear();
    return result;
  }

  clear() {
    this.values.length = 0;
    this.start = 0;
  }

  private compact() {
    if (this.start < 1024 || this.start * 2 < this.values.length) return;
    this.values.splice(0, this.start);
    this.start = 0;
  }
}
