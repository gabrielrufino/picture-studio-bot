# AGENTS.md

Telegram image-processing bot: TypeScript, grammY, MongoDB, sharp. Single package at the repo root (pnpm 10 / Node 24).

## Commands

- `pnpm install` — uses the committed `pnpm-lock.yaml`; do not add other lockfiles.
- `pnpm start:dev` — `tsx watch --env-file=.env`; use this locally.
- `pnpm build` — runs `tsc --noEmit` first, then bundles to `dist/index.cjs`.
- `pnpm start` — `node .` runs the built bundle; it does **not** load `.env`, so build and provide env vars first.
- `pnpm test` — full Vitest suite (`vitest run`).
- `pnpm vitest run src/handlers/rotate.handler.spec.ts` — one file; add `-t "..."` for one test.
- `pnpm test:cov`, `pnpm test:mutate` — coverage and Stryker (break threshold 60).
- `pnpm lint` / `pnpm lint:fix` — ESLint (`@antfu/eslint-config`; only `src` is linted).
- `pnpm build:check` — typecheck without emitting.

Baseline: lint, typecheck, and the full test suite pass.

## Environment

- Copy `.env.example` to `.env`: `BOT_TOKEN`, `MONGODB_CONNECTION_STRING`, `NODE_ENV`.
- `src/config/database.ts` throws at import time if `MONGODB_CONNECTION_STRING` is missing; `src/config/bot.ts` needs `BOT_TOKEN` at import time. Importing `src/index.ts`, `config/bot`, or `repositories` therefore requires both.
- Vitest does not load `.env`. Tests that touch those modules must mock `@/repositories` / config modules or set env vars themselves. Unit tests need no external Mongo; repository tests use `mongodb-memory-server`.
- `NODE_ENV=production` switches Pino from pretty output to JSON.
- Local Mongo: `mongodb://localhost:27017/picture_studio`; Docker Compose overrides it to host `mongo`. Full stack: `docker compose up --build`.

## Architecture

- `src/index.ts` is the only entrypoint: init all repositories, start the re-engagement cron, install middlewares, register commands/events from the `handlers` array, then `run(bot)`.
- Commands are auto-registered from each handler's `command` + `description`; `/help` builds its menu from the handler list. To add a command, extend `BaseHandler` (`command`, `description`, `events`, `onCommand`), add the enum value in `CommandEnum`, and register the instance in `coreHandlers` in `src/handlers/index.ts`.
- Handler `events` keys are grammy filter queries (`msg:photo`, `msg:text`, `callback_query`). `src/index.ts` routes each event to the handler matching `ctx.session.command`.
- Multi-step flows use the MongoDB-backed session (`command` + `params`), not in-memory state. Validate params with zod via `validateParams` and schemas in `src/schemas`; reset via `resetSession`/`setSessionCommand` and remove temp files. Watermark uses a `step` discriminator in its params.
- Non-image commands (start, help, language, feedback, pro, version) set `hasUsageLimits = false`; image commands reserve usage with `runWithUsage`, which rolls back on failure. Limits live in `src/config/constants.ts`; daily usage dates are UTC (`toISOString().split('T')[0]`).
- Repositories are singletons in `src/repositories/index.ts`. Register new repositories in the `repositories` array: `init()` creates collections, JSON schema validators, and indexes at startup. Repository methods use `@EnsureInitialized` for lazy init; entities extend `BaseEntity` (`created_at`/`updated_at`).
- User-facing text goes through `ctx.t(key)`. Keep `src/locales/en.json`, `es.json`, and `pt.json` in sync; a missing key renders as the raw key.
- Path alias `@/*` maps to `src/*` in both TypeScript and Vitest.
- Image processing uses sharp with UUID-named files in `os.tmpdir()`; clean them up. Compress/crop/resize/rotate reply with `replyWithPhoto`; convert and watermark send documents (media groups of max 10). The README claim that all results are documents is stale.

## Testing conventions

- `describe` blocks use `ClassName.name` and `ClassName.prototype.method.name` (for example `UserRepository.prototype.incrementUsage.name`), not string literals.
- Repository specs share a single `mongodb-memory-server` started by the Vitest global setup (`src/test/mongodb.global-setup.ts`, which exports `MONGODB_CONNECTION_STRING`). Use `connectToTestDatabase(name)` from `src/test/mongodb.ts` to get the client and a per-file database (`pdf_studio_test_<name>`), and close the client in `afterAll`.
- Handler specs mock `sharp`, `node:fs/promises`, `node:os`, and grammy's `InputFile`; follow that pattern for new handlers. Never import `src/index.ts` in tests.

## Documentation

- `docs/watermark.md` is the business and technical reference for the watermark feature.
- Every change must include a review of `docs/watermark.md`: if the change touches behavior, flow, limits, messages, schemas, callbacks, formats, algorithm, errors, or tests described there, update the document in the same change. Stale documentation is a bug.
- When limits or user-facing behavior change, update the relevant docs in the same change: `README.md` for global limits and `docs/watermark.md` for watermark-specific limits and behavior, plus the three locale files.

## CI/CD

- `.github/workflows/ci.yml` delegates to `actalog/node-ci@v3` on pull requests and pushes.
- `.github/workflows/cd.yml` builds and pushes the GHCR image only after CI succeeds on `main`.
- Commits are checked by Husky + commitlint and must follow Conventional Commits.
