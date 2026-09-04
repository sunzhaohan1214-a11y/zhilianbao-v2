# GitHub Release Gates

> 2026-09-04 覆盖规则：仓库保持公开，GitHub 仅承担版本管理、PR 审阅和代码中转；GitHub Actions required checks 已取消。合并门禁改为人工 Review 加 exact-SHA 本地验证摘要，详见 `LOCAL_FIRST_ZERO_EXTRA_COST.md`。

`main` must be protected before production release. M3-008 does not silently change repository settings because that is an external governance action.

Required branch policy:

- Pull requests required; direct push and force push disabled.
- At least one independent approval and stale approval dismissal after material changes.
- Required checks pinned to the exact PR head: `quality`, `database`, `critical-e2e`, `docker-build`, `security`, `performance`, `browser-compat`.
- Conversation resolution required; administrators do not routinely bypass gates.
- Merge only after the release evidence matrix is current.

`scripts/release-readiness.mjs` queries the live branch-protection endpoint and verifies each promised policy field: one approval, stale-review dismissal, all seven required checks, conversation resolution, administrator enforcement and force-push denial. It separately fetches `GITHUB_CANDIDATE_RUN_ID`, requires its `head_sha` to equal the exact `APP_VERSION` commit, and requires every named job to be `completed/success`. Unprotected or incomplete policy is `FAIL`; unavailable API evidence is `BLOCKED_BY_EXTERNAL_ENV`. Neither is PASS.
