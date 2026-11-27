# 03 — Remediation plan (a plan only, not permission to change code)

MSAP §25, §27–28: nothing changes until the PO reviews the findings and authorises a package. Packages R-3, R-5, R-6
and R-8 of MSAP-2026-11-04-01 are already authorised (`SPEC.md` D-63); the new packages below are proposals.
Order is a recommendation (**PO to confirm**).

| Package | Findings | Change (outline) | Verification | When |
|---|---|---|---|---|
| **R-9** | F-101 | Parse the request URL inside the error boundary (400 on failure); a process-level policy for unhandled rejections (log and keep running, or log and exit, PO to confirm) | Tests: raw `//`, absolute-form invalid target → 400 and the server keeps answering; P-05/P-06 no longer end the process | **First** |
| **R-10** | F-102 | Bound the change-rule reference by age (how old a reference may be: PO decision), per `EVENTS.md` §3.3 step 2; contract and example updated | Tests: a gap longer than the window gives no decision; the §3.5 example "Stark started 10 min ago" holds after a long gap | Second, before any `change` rule |
| R-11 | F-103, F-104, F-108, F-118 | Serialise logins (count before verify), one lock notice per lock, Host allow-list, end all sessions when the hash changes, documented hash procedure and minimum parameters | Login and Host tests; P-03/P-04 refused | Before relying on the web page |
| R-12 | F-105, F-113, F-114 | Keep polling until the stream delivers data; back off on repeated silent opens; poll during connect; drop a poll answer that arrives after the stream is back; report "polling only" | Feed tests with every socket opening silently (P-07 as a test) | With R-5 |
| R-13 | F-106, F-107, F-109 | Pool and statement time limits; serialise health checks; time-limit the report path; DDL `lock_timeout` and a fixed maintenance time; a pipeline-lag condition; count health from evaluated ticks | Health tests with a hanging store; lock test on PostgreSQL | After R-12 |
| R-6 (authorised) | F-009 + F-110 | Reject trade times outside a window around the local clock (covers Invalid Date) | Parser and pipeline tests (P-02) | As planned |
| R-5 (authorised) | F-007, F-014 (+ extensions) | Cap Retry-After; report a sleeping channel; drain on stop within a limit; `TimeoutStopSec` | Dispatcher and shutdown tests | As planned |
| R-3 (authorised) | F-003 (+ extension) | Guarded state write; no decision for a deleted or disabled rule | Storage tests | As planned |
| R-8 (authorised) | F-012, F-013 + F-119 | Start-up smoke test; SHA-pinned actions; isolate storage tests per test; tests that kill the four alert-logic survivors | CI green; shuffle seeds 6, 7, 12345 pass; Stryker re-run on those lines | As planned |
| R-14 | F-111, F-112, F-115 | Retry the pair list soon after a failed start; log a confirmation whose outcome is unknown; count health sends against quotas | Unit tests | Low |
| R-15 | F-116, F-117 | Deploy: exclude `.env*`, build off-host or as an unprivileged user; tighten both units (`systemd-analyze security` target) | Docs review; VPS score | Low |
| — | F-120 | Small fixes and wording, one change | Review | Low |
| — | F-004, F-010, F-011, F-016 | As before (PO decisions / measurement) | — | — |

Rollback for every package: revert its commit(s). R-10 and R-11 change behaviour the PO sees and update the contracts
in the same change.
