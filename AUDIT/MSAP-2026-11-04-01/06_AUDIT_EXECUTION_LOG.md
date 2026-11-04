# 06 — Execution log

Times UTC, 2026-11-04. "Subject" is `main` @ `b1c922d`. All work outside the repository unless stated.

| Time | Operation | Purpose | Result | Mutation risk | Actual mutation |
|---|---|---|---|---|---|
| 03:39 | `git status`, `git branch --show-current`, `git rev-parse HEAD`, `git diff`, `git diff --cached`, `git fetch origin main`, `git rev-parse origin/main`, `git diff origin/main HEAD` | Baseline (Phase 0) | Clean; branch `05c8681` = `main` `b1c922d` + one `TASKS.md` line; lockfile identical | None (fetch updates remote refs only) | None to the subject |
| 03:40 | `git archive b1c922d \| tar -x` into the audit folder; link to the existing `node_modules` | Read the exact subject without checking it out | 103 files | None | None |
| 03:40 | File inventory, line counts | Phase 1 | `src` 4,369 lines, `test` 4,491 | None | None |
| 03:41 | `eslint .` (no `--fix`) | Mode B | exit 0 | None | None |
| 03:41 | `tsc --noEmit` | Mode B | exit 0 | None | None |
| 03:41 | `vitest run` with `STARK_TEST_DATABASE_URL` | Mode B | 1 suite failed: ECONNREFUSED — the auditor's throwaway PostgreSQL was not running (environment, not subject) | None | None |
| 03:42 | Start the throwaway PostgreSQL (auditor's container, not Stark's) | Environment | Running | None to the subject | None |
| 03:42 | `vitest run` with the database; then twice without | Mode B, determinism | 26 files, 284 passed; 267 passed + 17 skipped, twice | None (tests use a random schema in the throwaway database) | None |
| 03:41 | `tsc -p tsconfig.build.json --outDir <audit folder>` | Mode B build | exit 0 | Writes only to the audit folder | None |
| 03:41 | `npm audit --audit-level=high`; `npm audit --omit=dev` | Dependency risk | exit 0; 11 moderate (dev); 0 production | None (read-only) | None |
| 03:42–03:47 | Read `src/` (all modules), `migrations.ts`, `ci.yml`, `deploy/*`, contracts and records; grep import graph | Phases 2–15 | See 01, 02, 04 | None | None |
| ~03:46 | Probes P-01, P-02 (`test/audit-probes/` inside the audit export) with `vitest run test/audit-probes` | Confirm F-001, F-009 | 2 passed (both mechanisms confirmed) | Writes only to the audit export | None |
| 03:48 | `git status --short`, `git rev-parse HEAD`, `git rev-parse origin/main origin/claude/ecstatic-cray-0n6il9` on the repository | Integrity (Phase 19) | See 07 | None | None |

The command outputs are kept in the audit folder's `logs/` and are not committed (they repeat what 04 quotes).
