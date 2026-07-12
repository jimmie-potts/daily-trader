# P1-08 Implementation Note

- Status: Complete
- Completed: 2026-07-11

## What Was Implemented

`.github/workflows/ci.yml` runs on pull requests and `main` pushes with read-only repository permission, concurrency cancellation, and a 20-minute timeout. It uses pinned action commits, Ubuntu 24.04, `.nvmrc`, npm 11.18.0, npm caching, `npm ci`, and the root `npm run ci` command. Checkout credentials are not retained. Coverage diagnostics upload on success or failure when present.

The workflow has no financial credentials, service containers, deployment, package publishing, or live endpoint. The local CI command runs formatting verification, linting, strict type checking, coverage tests, and production builds.

## Validation Evidence

- `npm run ci` passed on the final implementation.
- A temporary failing unit test allowed formatting, linting, and type checking to pass, then stopped CI at the coverage test step with a nonzero status. The probe was removed.
- npm 11.18.0 `npm ci` reproduced the committed lockfile from a tree with generated artifacts removed.
- The final offline npm audit reported zero known vulnerabilities.
- Workflow permissions and environment were reviewed for unnecessary access.

## Handoff

Keep `npm run ci` as the single local/hosted contract. Any new required workspace check belongs in that root command and documentation. Deployment and releases require separately scoped workflows and permissions.
