# 00 — Audit baseline and Start Gate

| Item | Value |
|---|---|
| Audit ID | MSAP-2026-11-09-01 (second system audit; first was MSAP-2026-11-04-01, gate A-1) |
| Protocol | MASTER SYSTEM AUDIT PROTOCOL V1.0 (file supplied by the PO, sha256 prefix `b7135a559a3efa90`; `SPEC.md` D-02, D-03) |
| Requested by | PO, 2026-11-06: "อัพเดทเป็น 24 ก่อนครับ ทำการ audit และทดสอบทุกมิติขั้นสูงสุด แล้วค่อยมาทำงานที่ค้างกัน" (`SPEC.md` D-64); scope proposed 2026-11-08; started on the PO's "audit ยัง" (2026-11-09), read as the go-ahead for the proposed scope |
| Repository | `AvengerTechLab/stark` |
| Subject | `main` @ `289e2433dd4ef55e30eec46caf2f226f9a9dfb07` (PR #24 merge: Node.js 24; includes R-1, R-2, R-4, R-7) |
| Session checkout at start | branch `claude/ecstatic-cray-0n6il9` @ `4bb0540` = `main` + one `TASKS.md` record commit (S6-17 VPS evidence); `git status --short` empty; `git diff`, `git diff --cached` empty |
| Start Gate | 2026-11-09T00:33:13Z — PASS |
| Stop Gate | see `07_AUDIT_FREEZE_RECORD.md` |
| Modes | A (static) + B (safe execution, extended) + C (operational, read-only, through commands the PO runs on the VPS and pastes) |

## Objective

Assess Stark as deployed on Node.js 24 across every dimension the PO asked for ("ทุกมิติขั้นสูงสุด"), re-check the 16
findings of MSAP-2026-11-04-01 and the four remediations done since (R-1, R-2, R-4, R-7), and give the PO a frozen list
of findings before the remaining work (R-5, R-6, R-3, R-8, extra channels).

## In scope

- The whole repository at `289e243`: `src/`, `test/`, migrations, `deploy/`, `.github/workflows/`, `scripts/`, the
  contracts and records.
- Nine dimensions (proposed to the PO 2026-11-08): (1) architecture and code reading; (2) test stability (repeated,
  shuffled, other time zone); (3) coverage; (4) mutation testing of all of `src/`; (5) security (history secret scan,
  live probes of the owner page on fakes, dependency audit); (6) failure injection (probes); (7) 35-day data volume in
  PostgreSQL; (8) three independent reviewers that did not write the code; (9) the VPS, read-only.

## Out of scope

- Any change to the subject, the VPS, the database of the live Stark, or any external service.
- Calls to real providers or channels (`CLAUDE.md` §5): no Bitkub, Binance, Telegram, LINE, Discord, Google request.
- `AvengerTechLab/avengertech` and the watchdog containers beyond what the PO's VPS output shows.

## Toolchain (auditor environment, outside the subject)

| Tool | Version | Where |
|---|---|---|
| Node.js / npm | v24.22.2 / 11.19.1 (official tarball, SHA-256 checked) | scratchpad |
| PostgreSQL | 16 (throwaway cluster, port 54329; databases `stark_test`, `stark_volume`) | auditor container |
| Subject copy | `git archive 289e243` into `export/`, own `npm ci` | audit folder |
| Coverage | `@vitest/coverage-v8` 5.0.4 (`npm install --no-save` in the export only) | audit folder |
| Mutation | `@stryker-mutator/core` + `vitest-runner` 10.1.1 (same) | audit folder |
| Browser | Chromium (pre-installed Playwright) | auditor container |
| Reviewers | three read-only sub-agents (security; reliability; correctness/contracts) | session |

Installing the coverage and mutation tools touched only the auditor's export copy; the repository, its lockfile and
`node_modules` were not changed (MSAP §3 protects the subject).
