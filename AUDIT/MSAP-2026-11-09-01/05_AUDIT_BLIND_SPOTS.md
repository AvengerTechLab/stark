# 05 — Blind spots and unknowns

| Area | State | Why |
|---|---|---|
| The VPS (Mode C) | PENDING → see below | Known only from read-only commands the PO runs and pastes |
| Real providers and channels | NOT VERIFIABLE | No real service may be called (`CLAUDE.md` §5): Bitkub silent-stream behaviour (F-105), Binance trade-time range (F-110), Telegram's handling of a confirm whose reply is lost (F-112), the WebSocket handshake timeout (F-113) |
| Browsers other than Chromium | NOT VERIFIED | F-101 shown in Chromium; Safari/Firefox and Chrome's local-network protections (F-101, F-108) not tested |
| Database hang (F-106) | VALIDATION REQUIRED | Reasoned from code; not reproduced (would need freezing a PostgreSQL server under a running Stark) |
| Real data volume | PARTIAL | 35 days measured on synthetic ticks at the maximum rate (1/s per pair); the real rate and the number of pairs are not known yet (F-010) |
| Restore with real data | NOT DONE | Needs the VPS (Discovered Work) |
| Equivalent mutants | PARTIAL | 726 survivors were triaged only in the alert path (rules, decimal, pipeline, dispatcher, storage, rule input); many others are log text or object literals |
| Auditor independence | IMPROVED, not complete | The lead wrote most of the code; three reviewers that did not write it read it independently, and every finding they raised that is kept here was checked by the lead. A human reviewer would still add independence |
| `AvengerTechLab/avengertech`, watchdog containers | Out of scope | D-61; only `docker ps` output, if the PO sends it |

Not found ≠ does not exist.

## Mode C — VPS (read-only, PO-run)

Requested 2026-11-09 ~00:41 UTC: Node version, uptime, memory, disk, `systemctl show stark`, backup timer and last
backup log, 7-day event counts and error count, `ufw`, `ss -tlnp`, `/etc/stark/*` modes, `systemd-analyze security
stark`, database size and row counts, pending updates, reboot flag, `docker ps`.

Result: **BLOCKED.** No output had arrived when the PO asked to continue on 2026-11-27 ("ทำต่อ"). Mode C is closed as
blocked, with the command list above as the open item. What is known about the VPS comes from earlier PO output
recorded in `TASKS.md` (S6-14 to S6-17): Node v24.22.2, service active, owner page on 127.0.0.1:8080 only, `ufw` with
22/tcp only (S6-14), and Docker publishing 80/443 for the watchdog (D-61). Not known: the `systemd-analyze security`
score (F-117), the first backup on Node 24, the 7-day event and error counts, database size, file modes under
`/etc/stark` since go-live, pending updates.
