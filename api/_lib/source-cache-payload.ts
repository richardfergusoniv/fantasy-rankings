import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Compress large `source_cache.payload` values in the existing text column.
 * Format: `gz1:` + base64(gzip(utf8 JSON)). Legacy rows stay plain JSON.
 * Reads accept either form so rollout needs no schema migration.
 */

export const SOURCE_CACHE_GZIP_PREFIX = "gz1:";
/** Compress when the UTF-8 JSON is at least this many bytes. */
export const SOURCE_CACHE_COMPRESS_THRESHOLD_BYTES = 50_000;

/**
 * Serialize `value` to a `source_cache.payload` string. Values whose JSON is
 * under the threshold stay uncompressed; larger blobs are gzip+base64 with
 * the `gz1:` prefix.
 */
export function encodeSourceCachePayload(value: unknown): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") < SOURCE_CACHE_COMPRESS_THRESHOLD_BYTES) {
    return json;
  }
  return SOURCE_CACHE_GZIP_PREFIX + gzipSync(json, { level: 6 }).toString("base64");
}

/**
 * Parse a `source_cache.payload` string. Transparent for legacy uncompressed
 * JSON and for `gz1:` compressed rows.
 */
export function decodeSourceCachePayload(raw: string): unknown {
  if (raw.startsWith(SOURCE_CACHE_GZIP_PREFIX)) {
    const json = gunzipSync(Buffer.from(raw.slice(SOURCE_CACHE_GZIP_PREFIX.length), "base64")).toString("utf8");
    return JSON.parse(json) as unknown;
  }
  return JSON.parse(raw) as unknown;
}

/** True when `raw` uses the compressed on-disk format. */
export function isCompressedSourceCachePayload(raw: string): boolean {
  return raw.startsWith(SOURCE_CACHE_GZIP_PREFIX);
}
