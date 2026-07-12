# P1-08: Add the Continuous Integration Gate

## User Story

As a maintainer, I want every change checked in a clean environment so that broken or unsafe foundation code is caught before merge.

## Acceptance Criteria

- CI installs the pinned Node.js version and dependencies from the committed lockfile without modifying it.
- CI runs formatting verification, linting, strict type checking, unit tests, and production builds from root-level commands.
- Jobs use least privilege, have bounded timeouts, and do not receive broker, market-data, or production credentials.
- Dependency caching cannot bypass lockfile validation or required checks.
- Test and coverage artifacts are retained when useful for diagnosing failures.
- The workflow avoids deploying, publishing packages, or contacting live financial services.
- The root documentation names the required checks and explains how to reproduce them locally.

## Validation

- Run the full local equivalent of the CI workflow.
- Verify a deliberately failing test on a temporary branch or local workflow run blocks the gate, then remove the change.
- Review workflow permissions and environment variables for unnecessary access.

## Out of Scope

Deployment pipelines, release automation, container publishing, and performance testing belong to later, separately scoped work.
