# P1-01 Implementation Note

- Status: Complete
- Completed: 2026-07-11

## What Was Implemented

The repository is an ESM npm-workspace monorepo on Node.js 22. Shared strict TypeScript settings live in `tsconfig.base.json`. Deployable shells are separated into `apps/api`, `apps/web`, and `workers/market-data`; shared code lives in `packages/domain`, `packages/config`, `packages/observability`, and `packages/test-utils`.

ADR 0001 records the runtime, npm workspaces, directory ownership, and initial Next.js/Fastify/worker boundaries. The lockfile pins the complete dependency graph. `.gitignore` excludes generated output, environment files, credentials, certificates, secrets, and account exports.

## Validation Evidence

- `npm ci` completed from the committed lockfile.
- `npm run build` built all shared packages, the Fastify API, the static Next.js page, and the worker.
- `npm audit --offline --json` reported zero known vulnerabilities after pinning a compatible PostCSS override.
- `@daily-trader/domain` has no runtime dependency or framework/provider import.

## Handoff

Add new deployable processes only with an ownership reason. Shared packages expose source types and built ESM runtime entry points; runtime consumers must build packages first. Keep provider SDKs inside future adapters and update ADRs, `README.md`, and `AGENTS.md` when foundational commands or structure change.
