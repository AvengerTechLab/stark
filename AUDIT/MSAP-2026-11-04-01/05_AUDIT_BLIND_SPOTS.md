# 05 — Blind spots and unknowns

| Area | State | Why |
|---|---|---|
| Auditor independence | VALIDATION REQUIRED | The auditor wrote most of the subject in earlier sessions. Conclusions rest on code read at this commit and on runs, but a second reviewer would reduce the bias |
| Live provider behaviour (Bitkub, Binance) | NOT VERIFIABLE | Mode C is out of scope; no real service may be called (`CLAUDE.md` §5). Bitkub's keep-alive behaviour (F-001) was not re-read |
| Telegram `getUpdates` confirmation semantics | VALIDATION REQUIRED | F-005 relies on the Bot API's documented behaviour, not re-read in this audit |
| Channel providers (LINE, Discord, Gmail) | NOT VERIFIABLE | Behaviour taken from the sources cited in the adapters; not exercised |
| Browser cookie handling over the SSH tunnel | VALIDATION REQUIRED | No browser login was run (F-008) |
| The VPS (systemd units as installed, PostgreSQL config, ufw, journald) | NOT VERIFIABLE | Mode C; known only from the PO's pasted outputs (`TASKS.md` S6-14, S6-15) |
| Real-volume performance (price log size, query time, dump time) | UNKNOWN | Stark has never run with real data (F-010) |
| Concurrency races (F-003) | VALIDATION REQUIRED | Shown by code; not reproduced against PostgreSQL |
| Production telemetry | NOT AVAILABLE | Stark has not run in production |
| `AvengerTechLab/avengertech` | Out of scope | Read only to look for the protocol file |

Not found ≠ does not exist: e.g. no document gives the tunnel command (F-008); one may exist outside the repository.
