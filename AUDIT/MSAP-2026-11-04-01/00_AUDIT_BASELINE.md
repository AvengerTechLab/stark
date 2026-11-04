# 00 — Audit baseline (Start Gate)

Audit ID: MSAP-2026-11-04-01 (Stark gate A-1, `SPEC.md` D-02) · Protocol: MASTER SYSTEM AUDIT PROTOCOL V1.0
(supplied by the PO on 2026-11-04 as `MASTER_SYSTEM_AUDIT_PROTOCOL_V1.0.md`, sha256 prefix `b7135a559a3efa90`; kept
outside the repository, D-03) · Requested by: PO, 2026-11-04 ("เริ่ม A-1", then the protocol file).

## Start Gate

| Condition | State |
|---|---|
| Repository / system identified | `AvengerTechLab/stark` |
| Branch identified | `main` |
| Immutable commit identified | `b1c922d4e5df7edb63c46876de290021ef546a12` (merge of PR #18, 2026-11-03) |
| Audit timestamp | 2026-11-04T03:39:26Z |
| Scope / out of scope | Below |
| Working-tree state | Below |
| Runtime / toolchain | Below |
| Audit mode | A (static) + B (safe execution), per D-02 |
| Read-only rules | MSAP §3; `CLAUDE.md` §6a |
| No-installation rule | Below |
| Audit objective | D-02: the state of Stark v1.0 (market data → rule → alert, end to end on fakes) before the first real alert |
| Baseline recorded | This file |

**Start Gate: PASS.** Audit Freeze starts at 2026-11-04T03:39:26Z.

## Subject state

- `git status` on the session's checkout: branch `claude/ecstatic-cray-0n6il9` at `05c8681`, clean; `git diff` and
  `git diff --cached` empty.
- That branch is one commit ahead of `main` (`05c8681`, one line of `TASKS.md`, made before the audit). The subject is
  `main` @ `b1c922d`, not the branch.
- The subject is read from a `git archive b1c922d` export in the auditor's scratch space. Nothing is checked out,
  committed or pushed in the repository during the audit.
- `package-lock.json` is identical between `b1c922d` and `05c8681`, so the export uses the session's existing
  `node_modules` (installed by `npm ci` before the audit) through a link: no installation during the audit.
- Size: 103 files; `src/` 4,369 lines of TypeScript, `test/` 4,491.

## Toolchain

| Item | Value |
|---|---|
| Language | TypeScript (strict), ES modules |
| Runtime | Node.js v22.23.4, npm 10.9.9 (CI: Node 22) |
| Runtime dependencies | `pg` 8.23.1, `hash-wasm` 4.12.0 |
| Build / typecheck | `tsc` (TypeScript 6.0.3) |
| Lint | ESLint 10.12.0, typescript-eslint 8.71.2 |
| Tests | Vitest 5.0.4; storage tests against a throwaway PostgreSQL 16 (`STARK_TEST_DATABASE_URL`) |
| CI | GitHub Actions `.github/workflows/ci.yml` (checkout@v7, setup-node@v7, postgres:16 service) |
| Deployment model | systemd on one Linux VPS (D-56): `deploy/stark.service` (installed, disabled), `deploy/stark-backup.service` + `.timer` (enabled) |
| Environment | No production run yet: Stark has never been started with real channels |

## In scope

- Everything in the repository at `b1c922d`: `src/`, `test/`, `scripts/`, `deploy/`, `.github/`, configuration files,
  and the contracts and records (`SPEC.md`, `ARCHITECTURE.md`, `EVENTS.md`, `API.md`, `DATABASE.md`, `SECURITY.md`,
  `TASKS.md`, `README.md`, `CLAUDE.md`, `.claude/skills/`).
- Mode B: `npm run lint`, `npm run typecheck`, `npm run test` (with the throwaway PostgreSQL), `npm run build` into a
  scratch output, `npm audit` (read-only), and probes that run code against fakes only.

## Out of scope

- Mode C (operational): the VPS, PostgreSQL on it, R2, Healthchecks, Telegram, LINE, Discord, Gmail and the market data
  providers. Mode C needs explicit authorization (MSAP §8) and real services may not be called (`CLAUDE.md` §5, §6).
  What is known about the host comes only from records the PO's outputs produced (`TASKS.md` S6-14, S6-15).
- `AvengerTechLab/avengertech` (read only to look for the protocol file; not audited).
- Fixing anything (MSAP §3).

## Auditor independence

The auditor (Claude) wrote most of the subject in earlier sessions. This is a known bias, recorded as a blind spot
(05): conclusions lean on evidence and on running code, not on remembered intent.
