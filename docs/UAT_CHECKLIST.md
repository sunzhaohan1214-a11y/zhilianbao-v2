# UAT Checklist

UAT is a named business acceptance event. CI, local E2E, screenshots, or developer confirmation cannot substitute for sign-off.

## Preconditions

- Exact candidate commit and environment URL recorded.
- TEST uses production-equivalent migrations and non-fake integrations where acceptance depends on them.
- Security, database, critical E2E, Docker, performance, and browser gates are green on the same commit.
- P0/P1 defect list is empty; accepted lower-severity exceptions have owners and dates.

## Business paths

- Login, activation, session/device revocation, and role-specific navigation.
- Enterprise/contact, demand lifecycle and ownership/collaboration.
- Member/presence, map/policy/talent, trips/visits, help, reimbursement, reporting, notifications.
- Attachment upload, real malware rejection, authorized preview/download, and undiscoverable unauthorized access.
- AI structured query: evidence links, private-question refusal, and safe fallback.
- SUPER-only system governance without broadening ordinary ADMIN.

## Acceptance evidence

- Candidate commit, tester, role, device/browser, timestamp, result, and defect ID.
- Chrome desktop, Firefox desktop, and Safari/WebKit mobile evidence.
- Shanghai-date checks while browser timezone is UTC and America/Los_Angeles.
- Signed business owner and operations owner decision.

Until signed evidence is attached to the release record, status is `BLOCKED_BY_UAT`.
