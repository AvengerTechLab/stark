# 06 — Execution log

Times UTC, 2026-11-09. "Subject" is `main` @ `289e243`. All work outside the repository unless stated.

| Time | Operation | Purpose | Result | Mutation risk | Actual mutation to the subject |
|---|---|---|---|---|---|
| 00:33 | `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git diff`, `git diff --cached`, `git fetch origin main`, `git rev-parse origin/main`, `git diff origin/main HEAD --stat` | Start Gate | Clean; HEAD `4bb0540` = `main` + one `TASKS.md` commit | None (fetch updates remote refs) | None |
| 00:33 | `git archive 289e243` into `export/` (119 files) | Read the exact subject | — | None | None |
| 00:33 | `npm ci` in `export/` (Node v24.22.2, npm 11.19.1) | Own dependencies for the copy | 147 packages | Auditor copy only | None |
| 00:33 | `eslint .`, `tsc --noEmit`, `tsc -p tsconfig.build.json --outDir build/`, `npm audit --audit-level=high`, `npm audit --omit=dev` | Mode B | all exit 0; 10 moderate (dev), 0 production | None | None |
| 00:34 | `vitest run` ×10 with `STARK_TEST_DATABASE_URL` (throwaway DB), ×3 without; shuffle seed 12345; `TZ=America/New_York` | Dimension 2 | 298 passed ×10; 280 + 18 skipped ×3; shuffle 2 failed; TZ 298 passed | Tests use random schemas in the throwaway DB | None |
| 00:35 | Shuffle seeds 1–8 | Dimension 2 | seeds 6, 7 fail the same 2 tests; others pass | Same | None |
| 00:36 | `npm install --no-save @vitest/coverage-v8@5.0.4 @stryker-mutator/core@10.1.1 @stryker-mutator/vitest-runner@10.1.1` in `export/`; `vitest run --coverage` | Dimension 3 | 92.05 % / 89.32 % | Auditor copy only | None |
| 00:36–00:49 | `stryker run` (config in `export/`, temp dir in audit folder) | Dimension 4 | 4,187 mutants, score 76.94 %, 12 min 38 s | Auditor copy only | None |
| 00:36 | Three read-only reviewer sub-agents started (security, reliability, correctness) | Dimension 8 | Reports 00:44–00:49 (`logs/14`, `16`, `19`) | Instructed read-only; reported no writes | None |
| 00:37 | `git log --all -p` → `logs/09-history.patch`; pattern scans | Dimension 5 (secrets) | Fakes only (E-129) | Read-only | None |
| 00:38 | Probes P-03, P-04 written in `export/test/audit-probes/` and run | Dimension 5 | E-105, E-111 | Auditor copy only (the correctness reviewer noticed these files appear and asked; recorded here: written by the lead) | None |
| 00:40 | A-1 probes copied into `export/test/audit-probes/` and run | Dimension 6 | P-01 no longer reproduces, P-02 does | Auditor copy | None |
| 00:41 | `createdb stark_volume`; Stark's own `migrate` + `ensurePartitions` from the audited build | Dimension 7 | 37 partitions | Throwaway DB | None |
| 00:42–00:44 | Load 12,096,000 demo ticks; sizes; `EXPLAIN ANALYZE` of the reference lookup; `pg_dump` + gzip; dump file deleted | Dimension 7 | E-126 | Throwaway DB | None |
| 00:41 | Read-only VPS command list sent to the PO | Dimension 9 | Pending | None (PO runs read-only commands) | None |
| 00:46 | P-05: audited handler wired as `index.ts`, raw invalid target | Verify reviewer N-01 | Process exit 1 | Loopback in a child process | None |
| 00:48 | P-06: curl `--path-as-is //`, Chromium `goto(//)` | Verify reviewer F3 | Process exit 1 both | Same | None |
| 00:49 | Lock chain in `stark_volume` (ACCESS SHARE / DDL / INSERT); temporary partition dropped | Verify reviewer F4 | E-110 | Throwaway DB | None |
| 00:50 | P-07 open-then-silent probe | Verify reviewer F1 | E-108 | Auditor copy | None |
| 00:50–00:54 | Mutation survivor triage; deliverables 00–07 written in the audit folder | Phases 16–18 | — | None | None |

Command outputs are in `logs/` (not committed: they repeat what 04 cites, and `09-history.patch` is the full history).
