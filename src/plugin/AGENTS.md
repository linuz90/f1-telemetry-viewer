# Telemetry servers

`session-summary-index.ts` is shared by the dev server (`telemetry-server.ts`, Vite middleware) and self-hosting (`server.ts`). It incrementally caches pre-dedup summaries for `/api/sessions` and resolves slugs for raw detail streaming. Lap recordings have their own index: [docs/lap-telemetry.md](../../docs/lap-telemetry.md).

## Summary cache

- The cache lives in `.cache/f1-telemetry-viewer/` under the viewer's working directory. It is private, derived, and safe to delete while the viewer is stopped. Never write cache files into `TELEMETRY_DIR` or rely on PnG's incomplete `.png_session_cache.json`.
- `SESSION_INDEX_FORMAT_VERSION` covers the persisted index envelope; bump it when that shape changes.
- `SESSION_SUMMARY_CACHE_VERSION` lives beside `buildSessionSummary()` in `src/utils/sessionSummary.ts`. Bump it whenever `SessionSummary`, `buildSessionSummary()`, filename or path normalization, or any policy a summary is computed from changes.
- Dedupe and final ordering changes need no summary-version bump: the index persists pre-dedup entries and re-derives the final list. Never persist globally derived `duplicateCount` values or raw telemetry in the index.
- Detail endpoints stream the indexed source file, never cached summary data.
- `pnpm benchmark:session-index` runs in a disposable scratch root outside live telemetry, prints aggregates only, and deletes only its own uniquely named run directory.
