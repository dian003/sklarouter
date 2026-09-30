# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### App development

```bash
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

The root app is a private Next.js package (`9router-app`). `npm run dev` uses `next dev --webpack --port 20127`; the README examples set `PORT=20128` for the normal router/dashboard port. Production builds use Next standalone output.

Bun variants exist for the root app:

```bash
npm run dev:bun
npm run build:bun
npm run start:bun
```

### Tests

Vitest tests live in `tests/` and rely on Vitest being available from `/tmp/node_modules` unless local tooling has been adjusted:

```bash
cd /tmp && npm install vitest
cd /Users/kikoy/Kikoy/cyberrouter/tests
npm test
npm run test:watch
```

Run a single test file from `tests/`:

```bash
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --reporter=verbose --config ./vitest.config.js unit/embeddingsCore.test.js
```

Translator and unit tests are both matched by `tests/vitest.config.js` (`**/*.test.js`). The config aliases `open-sse/*` to `../open-sse` and `@/*` to `../src`.

### Linting

There is an ESLint flat config (`eslint.config.mjs`) but no root `lint` script. Use:

```bash
npx eslint .
```

### CLI package

The published npm CLI is in `cli/` and is packed/published from the root scripts:

```bash
npm --prefix cli run dev
npm --prefix cli run build
npm run cli:pack
npm run cli:publish
```

`cli/package.json` includes a postinstall hook that prepares runtime dependencies under `~/.9router/runtime/node_modules`.

### Docs and Docker

```bash
npm --prefix gitbook run dev
npm --prefix gitbook run build
docker build -t 9router .
docker compose up
```

The GitBook docs app serves on port 3001. The Docker image runs `node custom-server.js`, which wraps the Next standalone server to sanitize/derive client IP forwarding headers.

## High-level architecture

9Router is a local AI routing gateway plus dashboard. It exposes OpenAI-compatible and related API surfaces under `/v1/*` while routing to many upstream providers with format translation, account fallback, token refresh, usage tracking, and token-saving transforms.

### Runtime layers

- `src/app/` is the Next.js App Router application.
  - `src/app/(dashboard)/dashboard/*` contains the dashboard pages.
  - `src/app/api/v1/*` and `src/app/api/v1beta/*` are compatibility endpoints such as chat completions, Claude messages, OpenAI Responses, embeddings, models, and search.
  - `src/app/api/*` also contains management APIs for auth, providers, provider nodes, keys, combos, settings, usage, translator tools, tunnels, proxy pools, and CLI tool configuration.
- `next.config.mjs` rewrites public `/v1/*`, `/v1beta/*`, `/responses`, and `/codex/*` paths into `src/app/api/*` routes. It uses standalone output and excludes docs/test-heavy paths from tracing/watching.
- `src/sse/` bridges Next route handlers to the provider-agnostic core. For chat, `src/sse/handlers/chat.js` validates API keys/settings, resolves aliases or combos, selects provider credentials, handles combo/fusion strategy, and delegates single-provider work to `open-sse/handlers/chatCore.js`.
- `open-sse/` is the shared routing/translation engine for chat, responses, embeddings, images, TTS, STT, fetch, and search. `open-sse/index.js` initializes side-effect registrations used by routes.

### Request flow for chat-like endpoints

`src/app/api/v1/{chat/completions,messages,responses}/route.js` initializes translators, then calls `handleChat()`. `handleChat()` parses the request, enforces `requireApiKey` when configured, resolves model aliases/combos via `src/sse/services/model.js`, obtains credentials via `src/sse/services/auth.js`, refreshes tokens via `src/sse/services/tokenRefresh.js`, and calls `open-sse/handlers/chatCore.js`. The core applies optional token-saving transforms, translates request format, dispatches to an executor, translates streaming or non-streaming responses back to the client format, and records usage/request details.

Fallback is two-level: account fallback happens inside the selected provider using `markAccountUnavailable`, and combo fallback/fusion is handled by `open-sse/services/combo.js` when the requested model string names a combo.

### `open-sse/` conventions

`open-sse/AGENTS.md` contains local rules for this engine. Important points:

- Keep constants, provider definitions, model data, role/block strings, and runtime knobs in `open-sse/config/`, `open-sse/providers/`, or translator schema modules rather than hardcoding them in handlers/executors.
- Translators self-register through `register(from, to, reqFn, resFn)` and must be imported in `open-sse/translator/index.js` for side effects. The default pipeline pivots through OpenAI as an intermediate format unless a direct translator is registered.
- Generic OpenAI-compatible providers normally only need provider/model registry entries; non-standard upstreams need an executor subclass registered in `open-sse/executors/index.js`.
- `open-sse/providers/registry/index.js` is generated static imports; do not hand-edit it after adding a registry provider.
- RTK/headroom/caveman/ponytail request transforms are designed to fail open. Do not throw from token-saver filters in a way that breaks request routing.

### Persistence and runtime state

- `src/lib/localDb.js` is a compatibility re-export of the SQLite-backed DB layer in `src/lib/db/`.
- `src/lib/db/driver.js` chooses drivers in this order: Bun `bun:sqlite`, `better-sqlite3`, Node `node:sqlite` (Node >=22.5), then `sql.js` fallback.
- Runtime state is stored under `DATA_DIR` when set, otherwise the app default path. Current docs and Docker expect SQLite at `$DATA_DIR/db/data.sqlite` or `/app/data/db/data.sqlite` in containers.
- Usage/request logging is handled through DB repos plus `src/lib/usageDb.js`/request details modules; optional deep request/translation logs are written under `logs/` when `ENABLE_REQUEST_LOGS=true`.
- Root layout imports `@/shared/services/bootstrap`, which initializes watchdog/tunnel/bootstrap behavior server-side except during Next build/static phases.

### Frontend organization

- Shared UI primitives, modals, constants, hooks, and utilities are under `src/shared/`.
- Zustand stores are in `src/store/`.
- Runtime i18n is under `src/i18n/`, with public locale assets in `public/i18n/` and translated READMEs in `i18n/`.
- `src/app/layout.js` wires global CSS, theme provider, runtime i18n provider, console log capture, outbound proxy initialization, and app bootstrap.

### Related packages and docs

- `cli/` is the npm package named `9router`; it starts/manages the built app and has its own README.
- `gitbook/` is a separate Next.js docs site.
- `docs/ARCHITECTURE.md` has detailed diagrams and module maps; verify it against code before relying on older details.
- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` files were present when this file was created.

## Environment notes

Common runtime variables are documented in `.env.example` and the README. The most important ones for local/dev verification are:

- `PORT` / `HOSTNAME` for server binding.
- `BASE_URL` and `CLOUD_URL` for server-side sync jobs; `NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_CLOUD_URL` remain public/backward-compatible counterparts.
- `DATA_DIR` for persistent app data.
- `JWT_SECRET`, `INITIAL_PASSWORD`, `API_KEY_SECRET`, `MACHINE_ID_SALT`, `AUTH_COOKIE_SECURE`, and `REQUIRE_API_KEY` for auth/security behavior.
- `ENABLE_REQUEST_LOGS` for sensitive request/translator logs.
- `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` and lowercase variants for outbound provider calls.
