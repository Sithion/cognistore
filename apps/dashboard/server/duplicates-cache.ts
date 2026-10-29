/**
 * Memoizes `/api/health/duplicates` (plan v2.6, item 1A.5).
 *
 * Duplicate detection scans every embedding, so the Settings panel only runs it
 * when the user asks — and asking twice on an unchanged base must not pay for
 * it twice. The cache key is a fingerprint of the base (`MAX(updated_at)`,
 * entry count, embedding count) plus the request options; any add, update or
 * delete — from this process or an agent session's MCP server — changes it.
 * Re-embedding rewrites vectors in place without touching `updated_at`, so the
 * sidecar calls `clear()` after `reembedAll`/`embedMissing`.
 *
 * Concurrent requests with the same key share one in-flight computation.
 */
export interface DuplicatesCache<T> {
  get(optionsKey: string, compute: () => Promise<T>): Promise<{ value: T; hit: boolean }>;
  clear(): void;
}

export function createDuplicatesCache<T>(fingerprint: () => string): DuplicatesCache<T> {
  let entry: { key: string; value: Promise<T> } | null = null;
  return {
    async get(optionsKey, compute) {
      const key = `${fingerprint()}|${optionsKey}`;
      if (entry && entry.key === key) return { value: await entry.value, hit: true };
      const value = compute();
      entry = { key, value };
      try {
        return { value: await value, hit: false };
      } catch (err) {
        // Never cache a failure.
        if (entry?.value === value) entry = null;
        throw err;
      }
    },
    clear() {
      entry = null;
    },
  };
}

/** Fingerprint of everything duplicate detection reads. Two aggregate scans of a few ms each at 10k rows. */
export const DUPLICATES_FINGERPRINT_SQL = `
  SELECT
    (SELECT MAX(updated_at) FROM knowledge_entries) AS maxUpdated,
    (SELECT COUNT(*) FROM knowledge_entries) AS entries,
    (SELECT COUNT(*) FROM knowledge_embeddings_rowids) AS embeddings`;
