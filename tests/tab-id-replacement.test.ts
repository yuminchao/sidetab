import { describe, expect, it } from "vitest";
import {
  createTabIdReplacementMap,
  DEFAULT_REPLACEMENT_LIMIT,
} from "../src/sidepanel/tab-id-replacement";

describe("tab id replacement map", () => {
  it("stores a removed -> replacement mapping", () => {
    const map = createTabIdReplacementMap();
    map.set(1, 9);
    expect(map.get(1)).toBe(9);
    expect(map.size).toBe(1);
  });

  it("overwrites an existing key without growing", () => {
    const map = createTabIdReplacementMap();
    map.set(1, 9);
    map.set(1, 10);
    expect(map.get(1)).toBe(10);
    expect(map.size).toBe(1);
  });

  it("deletes a key on demand", () => {
    const map = createTabIdReplacementMap();
    map.set(1, 9);
    map.delete(1);
    expect(map.get(1)).toBeUndefined();
    expect(map.size).toBe(0);
  });

  it("clears all entries", () => {
    const map = createTabIdReplacementMap();
    map.set(1, 9);
    map.set(2, 10);
    map.clear();
    expect(map.size).toBe(0);
    expect(map.get(1)).toBeUndefined();
    expect(map.get(2)).toBeUndefined();
  });

  it("evicts the oldest entry when the limit is exceeded (FIFO)", () => {
    const map = createTabIdReplacementMap(2);
    map.set(1, 101);
    map.set(2, 102);
    expect(map.size).toBe(2);
    map.set(3, 103);
    expect(map.size).toBe(2);
    expect(map.get(1)).toBeUndefined();
    expect(map.get(2)).toBe(102);
    expect(map.get(3)).toBe(103);
  });

  it("keeps the default limit bounded", () => {
    const map = createTabIdReplacementMap();
    for (let id = 1; id <= DEFAULT_REPLACEMENT_LIMIT + 50; id += 1) {
      map.set(id, id + 1000);
    }
    expect(map.size).toBe(DEFAULT_REPLACEMENT_LIMIT);
    expect(map.get(1)).toBeUndefined();
    expect(map.get(51)).toBe(1051);
  });
});
