# F1 Telemetry Viewer

Local-first React viewer for Pits n' Giggles (PnG) telemetry: session JSON and `.pngt` lap recordings. There is no database: the dev server and `pnpm start` index a telemetry folder on disk, the hosted build shows bundled demo data or files dropped into the browser, and PnG embeds the app as its save viewer. The README covers modes, setup and environment variables.

## Verify

- `pnpm build` type-checks the Node code and the app, then builds. It is the whole-app check.
- `pnpm test` runs every focused Node suite; `package.json` has a `test:<suite>` per area. There is no UI test runner or linter.
- Format touched files with Prettier (`pnpm exec prettier --write <files>`); `pnpm format` also rewrites two test fixtures.

## Conventions

- Telemetry math lives in two layers: generic primitives in `src/utils/stats/`, product models, rankings and insight thresholds in `src/analysis/`, which return plain typed models. Pages and components render those models and never compute telemetry themselves.
- Network fetching and caching go through the TanStack Query definitions in `src/queries/`; `TelemetryContext` binds them to React state.
- Changing `SessionSummary`, `buildSessionSummary()` or anything it computes from needs a `SESSION_SUMMARY_CACHE_VERSION` bump in `src/utils/sessionSummary.ts`.
- PnG's embed serves its own, older session summaries, so read every summary field as optional.
- Never commit real telemetry, `.env`, machine-specific paths or debug corpus data.

## Commits

Commit subjects feed the in-app What's new modal (`src/plugin/changelog.ts`), an addition to the shared commit rules:

- Only `feat`, `fix` and `docs` appear there, so their subjects describe what a user sees: `feat(ui): show tyre compounds in qualifying lap breakdown`, not `feat: refactor TyreChart to use compound map lookup`.
- Internal-only work uses `chore` or `refactor`; agent docs (`AGENTS.md`, `docs/`) use `chore(agents)`.

## Docs

- Telemetry fields, identity and exporter quirks: `docs/telemetry-data.md`
- Race pace, tyre wear, stint comparison, fuel and strategy: `docs/pace-and-strategy.md`
- Lap recordings and lap telemetry tips: `docs/lap-telemetry.md`
- Pages, charts, colour and UI components: `docs/ui.md`
- Data sources, repro files, worktrees and the PnG embed: `docs/running.md`
- Session index and summary cache: `src/plugin/AGENTS.md`
