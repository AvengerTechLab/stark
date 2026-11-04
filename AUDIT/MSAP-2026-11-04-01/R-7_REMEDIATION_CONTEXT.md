# R-7 — Remediation context

| Field | Value |
|---|---|
| Remediation ID | R-7 |
| Source audit ID | MSAP-2026-11-04-01 |
| Source commit | `main` @ `b1c922d` (audited); changed on `main` @ `f159659` plus PR #22 |
| Selected findings | F-008 (how the PO opens the owner page is undocumented; the cookie path is unverified), F-015 (documentation drift) |
| Approved scope | A new guide `deploy/WEB.md`; `API.md` §1 and §1.1; `EVENTS.md` §2.4 and §3.1; `README.md` status and document list; the records (`SPEC.md` D-62, `TASKS.md`) |
| Excluded scope | All code, including the cookie attributes and the Origin check; every other finding |
| Change objective | The PO can open the owner page from their own computer by following one document, and the documents match what is built and decided |
| Verification plan | A login through `http://localhost` in a real browser against Stark on fakes; the PO's login through the real tunnel; review of each corrected statement against code and `SPEC.md` |
| Rollback plan | Revert the R-7 commit (documents only) |
| Approver | PO, 2026-11-04 ("ทำ R-7: เขียนวิธีเปิดหน้าเว็บผ่าน SSH tunnel แล้วลอง login ใน browser ของคุณ"; `SPEC.md` D-62) |
| Timestamp | 2026-11-04 |

## Change

- `deploy/WEB.md` (Thai): `ssh -N -L 8080:127.0.0.1:8080 stark`, then `http://localhost:8080` in Chrome or Firefox;
  what a working login looks like (the Telegram login notice, still logged in after a reload); logging out and closing
  the tunnel; a table of symptoms (no tunnel, Stark not running, cookie not kept, lockout, a hash made from another
  password); and a table of test results.
- `API.md` §1: the page is served on `127.0.0.1` and reached through the SSH tunnel (D-38, D-53), replacing "over
  HTTPS only". §1.1: no longer "(proposed)"; the "HTTPS … chosen with hosting, PO to confirm" line is replaced by the
  transport as decided: plain HTTP on `127.0.0.1:8080` inside the SSH tunnel, `localhost` in the address bar, and why
  the `Secure` cookie and the Origin check still work.
- `EVENTS.md` §2.4: the feed and disk timings cite D-55 instead of "(proposed)"; the heartbeat cites D-57 instead of
  "(proposed timings)". §3.1: the PO creates two rules for THB and USDT; no interface has a "both" choice.
- `README.md`: Stark runs on its VPS since 2026-11-04 after gate A-1, instead of "Hosting and gate A-1 wait on the
  PO"; the document list names `deploy/`.

## Verification

- Browser check, 2026-11-04, on Claude's machine: Stark started as in `test/e2e/stark.test.ts` (every outside system
  faked, the made-up password, owner page on `127.0.0.1:18080`), driven by Playwright's Chromium at
  `http://localhost:18080/`. The login form logged in; the cookie `stark_session` was stored with `secure=true`,
  `sameSite=Strict`; a rule (`BTC/THB`, ≥ 1, telegram, demo values) was added through the page, so the Origin check
  passed; after a reload the page was still logged in. The one console error was the page's first `401` before login,
  which is expected. The probe file was deleted afterwards and is not committed.
- Each corrected statement was read against `src/interface/http-server.ts` (cookie, Origin check, lockout),
  `src/config.ts` (`OWNER_HTTP_HOST`, `OWNER_HTTP_PORT` defaults), `src/interface/web.ts` (the messages the page
  shows) and `SPEC.md` D-35, D-53, D-55, D-57.
- The PO's login, 2026-11-04 14:55: through the real tunnel (`ssh -N -L 8080:127.0.0.1:8080 root@143.14.11.53`, after
  the `stark` alias failed because it was never set up) the PO logged in at `http://localhost:8080` on their Mac
  and sent a PDF printed from the page: prices, rules form, channels, health (`degraded: false`) and the 13:33:46
  test alert (telegram, delivered) all shown. The browser was not named.
- Not verified: Safari specifically.

## Re-audit of the affected area (MSAP §29)

- F-015: each statement listed in 02 now matches the code and the decisions. **F-015: RESOLVED.**
- F-008: the tunnel command and URL are documented, the cookie path works in Chromium, and the PO logged in through
  the real tunnel (recorded in `deploy/WEB.md`). **F-008: RESOLVED.**
