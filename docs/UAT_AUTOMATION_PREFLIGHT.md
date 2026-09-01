# UAT automation preflight

This document maps the business paths in `docs/UAT_CHECKLIST.md` to repository automation. It is an evidence index, not UAT sign-off. Its status is fixed at `BLOCKED_BY_UAT`, and `RELEASE_READY=NO` remains unchanged until named business and operations acceptance evidence is attached to the exact release candidate.

`docs/PRD-v1.2.md` is not present at the audited baseline (`631f955977fee52d6fda703fc5a257bd51602aba`); the required fallback `docs/PRD.md` was used for this analysis.

## Coverage matrix

| UAT business path | Unit / database integration | Security / E2E | Remaining real UAT evidence |
| --- | --- | --- | --- |
| Login, activation, session/device revocation, role navigation | `auth-foundation.test.ts`, `auth.test.ts` | `route-matrix.test.ts`, `auth.spec.ts` | Named tester, role and device/browser record |
| Enterprise/contact and demand lifecycle/ownership/collaboration | `enterprise-foundation.test.ts`, `enterprise.test.ts`, `demand-lifecycle.test.ts`, `demand-claim-collaboration.test.ts` | `enterprise.spec.ts`, `demand-lifecycle.spec.ts` | Business scenario result and defect disposition |
| Member/presence, map/policy/talent, trips/visits, help, reimbursement, reporting and notifications | Corresponding module unit and database suites | Corresponding module E2E suites plus route matrix | Named cross-role acceptance evidence |
| Attachment upload, malware rejection and authorized access | `attachment-foundation.test.ts`, `attachments.test.ts` | `clamav-integration.mjs`, attachment chain in `auth.spec.ts` | Real TEST upload/preview/download record; automation is not production scanner acceptance |
| AI evidence links, private refusal and safe fallback | `ai-evaluation.test.ts` | `route-matrix.test.ts`, mocked weak-network behavior in `weak-network.spec.ts` | Real ChatService/UI evidence-link acceptance is not automated; real provider acceptance remains external |
| SUPER-only system governance without broadening ADMIN | `system-admin.test.ts` unit/database suites | `route-matrix.test.ts`, `system-admin.spec.ts` | Named SUPER and ADMIN acceptance record; fake providers are not real cloud acceptance |
| Chrome/Firefox/WebKit, timezone and weak network | `presence-e2e-time.test.ts` | `browser-compat.spec.ts`, `weak-network.spec.ts` | Required named device/browser/timestamp evidence |

The confirmed automation gap is evidence governance itself: the former `scripts/test-evidence.mjs` only counted files. It did not bind evidence to a candidate commit, verify mapped files, or fail closed. The updated command now requires an exact 40-character SHA equal to a clean checked-out HEAD, verifies every mapped evidence path exists in that commit and as a regular local file, and records a SHA-256 for each file.

## Generate candidate-bound evidence

Run from a clean checkout of the candidate:

```bash
npm run test:evidence -- --candidate-sha=<40-character-candidate-sha>
```

The command writes ignored local artifacts `artifacts/uat-automation-preflight.json` and `artifacts/uat-automation-preflight.md`. In file-output mode it first rejects a symlinked or non-directory `artifacts` path, then removes reports from an earlier run before validation. Any malformed/mismatched SHA, dirty worktree, uncommitted evidence path, missing file, symlink or invalid matrix entry exits non-zero without leaving a stale success report behind or following an output-directory link outside the repository.

## Required verification

```bash
npx vitest run tests/unit/test-evidence.test.ts
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:security
npm run security:secrets
npm run security:code
git diff --check
```

Database, critical E2E, browser compatibility, real ClamAV, build and exact-head CI evidence must run in their governed TEST/CI environments. This local preflight neither starts those environments nor claims their result.

## Open blockers

- Attach UAT records for the exact candidate SHA with tester, role, device/browser, timestamp, result and linked defect disposition.
- Attach business and operations sign-off with zero open P0/P1 acceptance defects.
- Attach exact-head CI results and governed real TEST integration evidence separately.
- Keep real AI provider, production scanner, backup/restore, maintenance, migration rehearsal and cutover evidence external to this local automation index.
