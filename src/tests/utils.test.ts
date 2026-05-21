import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debounce, generateId, clamp } from "../shared/utils";

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls fn after delay", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("resets timer on repeated calls", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    debounced();
    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("generateId", () => {
  it("returns string with prefix", () => {
    expect(generateId("msg")).toMatch(/^msg-/);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("clamp", () => {
  it("clamps to min", () => expect(clamp(-5, 0, 10)).toBe(0));
  it("clamps to max", () => expect(clamp(15, 0, 10)).toBe(10));
  it("passes through in range", () => expect(clamp(5, 0, 10)).toBe(5));
});
