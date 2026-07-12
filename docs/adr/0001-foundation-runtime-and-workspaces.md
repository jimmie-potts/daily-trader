# ADR 0001: Foundation Runtime and Workspaces

- Status: Accepted
- Date: 2026-07-11

## Context

Phase 1 needs a small TypeScript monorepo with explicit boundaries and repeatable root commands. The documented application shape includes a Next.js web app, Fastify API, Node.js workers, and shared packages.

## Decision

Use Node.js 22 (minimum 22.13, before Node 23), npm 11.18.0, ECMAScript modules, strict TypeScript, npm workspaces, and a committed npm lockfile. Keep deployable processes under `apps/` and `workers/`, shared application-owned code under `packages/`, local runtime definitions under `infrastructure/`, and cross-cutting decisions under `docs/adr/`.

Use Next.js for `apps/web`, Fastify for `apps/api`, and a plain long-running Node.js process for `workers/market-data`. These processes may depend on shared packages; domain code must not depend on them.

## Consequences

Npm workspaces avoid another orchestration dependency at the current scale. Root scripts must compose workspace scripts, and package public entry points must remain explicit. Replacing a framework later must not require changing domain contracts.
