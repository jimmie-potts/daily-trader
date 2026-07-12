# P1-03: Establish Code Quality Checks

## User Story

As a contributor, I want consistent automated checks so that every workspace follows the same maintainable TypeScript standards.

## Acceptance Criteria

- One formatter and one TypeScript-aware linter are configured at the repository root.
- Strict type checking and production builds run across all workspaces.
- Root-level commands exist for formatting checks, linting, type checking, and building.
- Workspace-specific commands compose into the root commands without duplicated configuration.
- Generated files, dependencies, and external fixtures are excluded deliberately rather than hiding source warnings broadly.
- Rules discourage unsafe types, ignored promises, unused code, and unhandled errors without disabling checks globally.
- The root documentation explains how to run and, where applicable, automatically fix each check.

## Validation

- Run every quality command from the repository root.
- Introduce a temporary formatting, lint, and type error locally and verify the corresponding check fails; remove those changes afterward.
- Confirm the checks do not rewrite files when run in verification mode.

## Out of Scope

This story does not establish CI, runtime services, or business behavior.
