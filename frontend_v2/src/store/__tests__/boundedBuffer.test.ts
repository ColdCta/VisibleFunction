import { describe, expect, it } from "vitest";
import { BoundedBuffer } from "../boundedBuffer";

describe("BoundedBuffer", () => {
  it("keeps only the newest bounded live records under sustained load", () => {
    const buffer = new BoundedBuffer<number>(8192);
    let dropped = 0;
    for (let value = 0; value < 100_000; value++) {
      if (buffer.push(value) !== undefined) dropped++;
    }

    expect(buffer.size).toBe(8192);
    expect(dropped).toBe(100_000 - 8192);
    const values = buffer.drain();
    expect(values[0]).toBe(100_000 - 8192);
    expect(values.at(-1)).toBe(99_999);
    expect(buffer.size).toBe(0);
  });

  it("clears paused data without retaining references", () => {
    const buffer = new BoundedBuffer<object>(4);
    buffer.push({});
    buffer.push({});
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.drain()).toEqual([]);
  });
});
