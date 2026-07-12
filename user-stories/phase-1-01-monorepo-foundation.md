# P1-01: Establish the TypeScript Monorepo

## User Story

As a contributor, I want a documented TypeScript workspace so that applications, workers, and shared packages can evolve behind clear ownership boundaries.

## Acceptance Criteria

- An accepted ADR records the package manager, workspace tool, Node.js support policy, and initial directory layout.
- The repository contains intentional locations for the web application, API, market-data worker, shared domain code, configuration, observability, infrastructure, and tests.
- TypeScript uses strict settings from a shared base configuration; each workspace has an explicit public entry point.
- Root workspace commands can install dependencies and build all initial workspaces from a clean checkout.
- Dependency versions are locked, generated output and local secrets are ignored, and no credentials are committed.
- The scaffold contains no provider SDK types, market-data behavior, signal logic, or order-execution behavior.
- The root `README.md` and `AGENTS.md` describe the resulting structure and newly established commands.

## Validation

- Perform a clean dependency install using the committed lockfile.
- Run the root build command and confirm every workspace participates.
- Inspect the dependency graph to confirm domain code has no framework or vendor dependencies.

## Notes

Prefer the smallest workspace layout that preserves the documented architectural boundaries. Do not add distributed infrastructure or extra applications in anticipation of later phases.
