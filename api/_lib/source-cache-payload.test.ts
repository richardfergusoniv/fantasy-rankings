import { describe, expect, it } from "vitest";
import {
  decodeSourceCachePayload,
  encodeSourceCachePayload,
  isCompressedSourceCachePayload,
  SOURCE_CACHE_COMPRESS_THRESHOLD_BYTES,
  SOURCE_CACHE_GZIP_PREFIX,
} from "./source-cache-payload.js";

describe("source_cache payload compression", () => {
  it("round-trips a small payload as plain JSON", () => {
    const value = { hello: "world", n: 1 };
    const encoded = encodeSourceCachePayload(value);
    expect(isCompressedSourceCachePayload(encoded)).toBe(false);
    expect(encoded.startsWith("{")).toBe(true);
    expect(decodeSourceCachePayload(encoded)).toEqual(value);
  });

  it("round-trips a large payload with the gz1: prefix", () => {
    const value = {
      blob: "x".repeat(SOURCE_CACHE_COMPRESS_THRESHOLD_BYTES),
      nested: { ok: true },
    };
    const encoded = encodeSourceCachePayload(value);
    expect(isCompressedSourceCachePayload(encoded)).toBe(true);
    expect(encoded.startsWith(SOURCE_CACHE_GZIP_PREFIX)).toBe(true);
    expect(encoded.length).toBeLessThan(SOURCE_CACHE_COMPRESS_THRESHOLD_BYTES);
    expect(decodeSourceCachePayload(encoded)).toEqual(value);
  });

  it("transparently reads legacy uncompressed JSON", () => {
    const legacy = JSON.stringify({ presets: { a: [1, 2, 3] }, note: "plain" });
    expect(isCompressedSourceCachePayload(legacy)).toBe(false);
    expect(decodeSourceCachePayload(legacy)).toEqual({
      presets: { a: [1, 2, 3] },
      note: "plain",
    });
  });
});
