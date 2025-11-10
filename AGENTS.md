# Repository Guidelines

## Project Structure & Module Organization
The MCP server starts in `src/index.ts`, which wires prompts, utils, and every service registrar. Keep feature logic inside `src/services/<service>/` and export it through the folder’s `index.ts`. Prompts live in `src/prompts/`, shared auth/logging helpers in `src/utils/`, references in `docs/`, and build output in `dist/` (never edit). Tests mirror runtime code: fast specs under `test/unit/`, protocol flows in `test/integration/`, fixtures in `test/mocks/`, helpers in `test/utils/`.

## Build, Test, and Development Commands
- `pnpm install` – install workspace dependencies (Node 18+).
- `pnpm dev` – execute `ts-node src/index.ts` for hot iteration.
- `pnpm build` – compile via `tsc` and copy monitoring prompt assets into `dist/` (run before `pnpm start`).
- `pnpm start` – launch the compiled MCP server from `dist/index.js`.
- `pnpm lint` / `pnpm lint:fix` – enforce ESLint rules prior to a PR.
- `pnpm format:check` – ensure Prettier alignment on `src/**/*.ts`.

## Coding Style & Naming Conventions
Use TypeScript with ECMAScript modules, 2-space indentation, and trailing commas as shown in `src/index.ts`. Favor named exports (`registerFooTools`) and kebab-case files (`resource-discovery.ts`); tests append `.test.ts`. Keep logging structured via `utils/logger.ts` (no `console.log`). When adding a service, expose `register<Service>Resources` / `register<Service>Tools` from that folder’s `index.ts`.

## Testing Guidelines
Vitest powers all suites. Co-locate fast specs under `test/unit/` (e.g., `services/<service>.test.ts`) and multi-service scenarios in `test/integration/`, using `test/setup.ts` for shared hooks. Mock Google Cloud clients from `test/mocks/` to avoid live API calls, and only exercise real credentials behind explicit env guards. Run `pnpm test` for CI parity, `pnpm test:watch` while iterating, and `pnpm test:coverage` before release work.

## Commit & Pull Request Guidelines
Follow the existing imperative style (`Map Support API 401 errors…`). Reference issue IDs or service names when relevant, and keep the subject under ~72 characters. Each PR should summarize the change, list verification commands, attach screenshots for user-facing flows (e.g., prompt tweaks), and call out any new tools or environment variables. Keep PRs scoped to a single service or feature to ease review.

## Security & Configuration Tips
Never commit credential files or `.env` data. Use environment variables (`GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CLOUD_PROJECT`, optional `LAZY_AUTH`) and document new ones in the README. Enable `DEBUG=1` only during local diagnostics, and prefer least-privilege service accounts while scrubbing logs before sharing traces externally.

## Documentation Expectations
- Treat `docs/` (deep dives, references) as part of every feature change—if the behaviour, env vars, or tooling surface shifts, update the relevant docs alongside the code.
- Keep the README in sync with user-facing flows, and call out the documentation updates in your PR checklist.
- When adding security controls or policies, document both the default posture and the configuration knobs so operators can reason about them.
