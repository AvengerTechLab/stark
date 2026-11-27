# System audit MSAP-2026-11-09-01 (second audit, Node.js 24)

Audit of `AvengerTechLab/stark` `main` @ `289e243` under the **MASTER SYSTEM AUDIT PROTOCOL V1.0**, run on 2026-11-09
from 00:33 UTC, Modes A + B (extended); Mode C (read-only through the PO) blocked, at the PO's request (`SPEC.md` D-64:
"ทำการ audit และทดสอบทุกมิติขั้นสูงสุด").

**Status:** COMPLETE (Stop Gate PASS, 2026-11-27). Findings are **frozen**. Mode C (the VPS) was BLOCKED: the PO's
read-only output did not arrive (05).

| File | Content |
|---|---|
| [`00_AUDIT_BASELINE.md`](00_AUDIT_BASELINE.md) | Start Gate, scope, the nine dimensions, toolchain |
| [`01_SYSTEM_ARCHITECTURE_AUDIT.md`](01_SYSTEM_ARCHITECTURE_AUDIT.md) | What changed since the first audit; what was confirmed |
| [`02_ARCHITECTURE_FINDINGS.md`](02_ARCHITECTURE_FINDINGS.md) | 20 new findings F-101…F-120; re-check of F-001…F-016 |
| [`03_ARCHITECTURE_REMEDIATION_PLAN.md`](03_ARCHITECTURE_REMEDIATION_PLAN.md) | Proposed packages R-9…R-15; a plan only |
| [`04_EVIDENCE_INDEX.md`](04_EVIDENCE_INDEX.md) | Evidence E-101…E-130 |
| [`05_AUDIT_BLIND_SPOTS.md`](05_AUDIT_BLIND_SPOTS.md) | What could not be verified; the VPS (Mode C) |
| [`06_AUDIT_EXECUTION_LOG.md`](06_AUDIT_EXECUTION_LOG.md) | Every operation and its mutation risk |
| [`07_AUDIT_FREEZE_RECORD.md`](07_AUDIT_FREEZE_RECORD.md) | Freeze record and Stop Gate |
| [`probes/`](probes/) | Probe scripts P-03…P-07 and the volume load (demo data) |

## Measurements

| Dimension | Result |
|---|---|
| Lint, typecheck, build, dependency audit | All clean on Node v24.22.2; production dependencies 0 advisories; dev 10 moderate |
| Test stability | 298/298 ×10 with PostgreSQL; 280 + 18 skipped ×3 without; passes in another time zone; **2 tests fail under 3 of 9 shuffle seeds** |
| Coverage | 92.05 % statements, 89.32 % branches (`index.ts` 35 %) |
| Mutation (all `src/`) | 4,187 mutants, score **76.94 %**; survivors in core alert logic (F-119) |
| Security | No secret in 111 commits; owner page: crash (F-101), lockout race (F-103), sessions (F-104), Host (F-108) |
| Failure injection | A-1 P-01 fixed, P-02 still present; new P-05…P-07 |
| 35-day volume (4 pairs, 1/s, demo) | 12.1 M rows, 2.56 GB; lookup < 1 ms; dump 1.43 GB in 13 s (416 MB gzip) |
| Independent review | 3 reviewers; their kept findings checked by the lead |

## Findings by severity (new)

| S4 | S3 | S2 | S1 | S0 |
|---|---|---|---|---|
| 0 | 1 (F-101) | 5 (F-102…F-106) | 13 | 1 (bundle of 12) |

First audit's findings now: 6 RESOLVED (F-001, F-002, F-005, F-006, F-008, F-015; three with residuals), 9 OPEN, 1
PARTIAL (F-010).

## System health (MSAP §22; separate from audit completion)

| Domain | Assessment | Basis |
|---|---|---|
| Architecture | COHERENT | Layers, ports and one composition root unchanged |
| Correctness | CONCERN | Level rules sound; change rules can send false alerts after a gap (F-102) |
| Reliability | DEGRADED | One request can stop the process (F-101); R-1 and R-2 leave residual silent paths (F-105, F-106) |
| Security | ADEQUATE (with concerns) | Secrets handling sound; owner-page issues F-101, F-103, F-104, F-108 need the tunnel or local access |
| Testing | STRONG in breadth, MIXED in depth | 298 deterministic tests and 92 % coverage, but 77 % mutation score and order-dependent tests |
| Performance | ADEQUATE | 35 days at the maximum rate fits the disk and queries stay under 1 ms |

Recommended before more real use (**PO to confirm**): R-9 (F-101), and R-10 (F-102) before any `change` rule. Until
then: open the SSH tunnel only while using the page, and use `/above` and `/below` rules only.
