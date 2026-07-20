// annotation-media-embeds — HTTP Range parsing for the stream-through media
// serving path (docs/ideas/annotation-media-embeds.md § Design details: served
// "streamed through the worker from the R2 binding with Range support"). Pure
// unit — single-range `bytes=` forms only; multi-range / garbage → null (serve
// the whole object); an out-of-bounds range → "unsatisfiable" (416).
import { describe, expect, it } from "vitest";
import { parseRange, resolveRange } from "./media-range";

describe("parseRange", () => {
  it("returns null for no header (serve full)", () => {
    expect(parseRange(undefined, 100)).toBeNull();
  });
  it("parses a closed range bytes=0-3", () => {
    expect(parseRange("bytes=0-3", 100)).toEqual({ offset: 0, length: 4 });
  });
  it("parses an open-ended range bytes=4-", () => {
    expect(parseRange("bytes=4-", 100)).toEqual({ offset: 4 });
  });
  it("parses a suffix range bytes=-5", () => {
    expect(parseRange("bytes=-5", 100)).toEqual({ suffix: 5 });
  });
  it("returns null for garbage (serve full)", () => {
    expect(parseRange("rows=0-3", 100)).toBeNull();
    expect(parseRange("bytes=abc", 100)).toBeNull();
    expect(parseRange("bytes=0-3,10-20", 100)).toBeNull(); // multi-range → serve full
  });
  it("flags an unsatisfiable range past the end", () => {
    expect(parseRange("bytes=200-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=100-105", 100)).toBe("unsatisfiable");
  });
});

describe("resolveRange", () => {
  it("resolves a closed range to absolute offset/length", () => {
    expect(resolveRange({ offset: 0, length: 4 }, 100)).toEqual({ offset: 0, length: 4 });
  });
  it("resolves an open-ended range to the tail", () => {
    expect(resolveRange({ offset: 4 }, 100)).toEqual({ offset: 4, length: 96 });
  });
  it("resolves a suffix range to the last N bytes", () => {
    expect(resolveRange({ suffix: 5 }, 100)).toEqual({ offset: 95, length: 5 });
  });
});
