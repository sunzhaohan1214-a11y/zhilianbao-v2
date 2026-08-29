# GitHub Release Gates

`main` must be protected before production release. M3-008 does not silently change repository settings because that is an external governance action.

Required branch policy:

- Pull requests required; direct push and force push disabled.
- At least one independent approval and stale approval dismissal after material changes.
- Required checks pinned to the exact PR head: `quality`, `database`, `critical-e2e`, `docker-build`, `security`, `performance`, `browser-compat`.
- Conversation resolution required; administrators do not routinely bypass gates.
- Merge only after the release evidence matrix is current.

`scripts/release-readiness.mjs` queries live branch metadata. Unprotected `main` is `FAIL/EXTERNAL_ACTION_REQUIRED`; unavailable API evidence is `BLOCKED_BY_EXTERNAL_ENV`. Neither is PASS.
