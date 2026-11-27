# R-9 — Remediation context

| Field | Value |
|---|---|
| Remediation ID | R-9 |
| Source audit ID | MSAP-2026-11-09-01 |
| Source commit | `main` @ `289e243` (audited); changed on `main` @ `cbfcbe5` |
| Selected findings | F-101 (one request with a malformed target ends the Stark process) |
| Approved scope | `src/interface/http-server.ts` (the request handler's error boundary), `src/index.ts` (a process-level handler for uncaught errors), their tests, `API.md` §1.4, the records |
| Excluded scope | Every other finding, including F-103/F-104/F-108 on the same page |
| Change objective | No request, however malformed, can end the process; an error nothing catches is logged through the redacting logger before the exit |
| Verification plan | Tests failing on the old code; control runs; full check with PostgreSQL; P-05 and P-06 repeated against the new build |
| Rollback plan | Revert the R-9 commit; no data or schema change |
| Approver | PO, 2026-11-27 ("อนุมัติ R-9 R-10 ตามคำแนะนำ"; `SPEC.md` D-66) |
| Timestamp | 2026-11-27 |

## Change

- `ownerHandler` parses the request target inside its error boundary. A target that is not a valid URL (`//`, `///`,
  `//[/`, `http://a:99999/`) is answered `400` `bad request` (plain text: no route is known yet).
- The function the HTTP server calls wraps the whole response in a second boundary: if even the error answer cannot
  be written (a closed socket), it logs `owner.response_failed` and destroys the connection. The returned promise
  never rejects, so `void handler(req, res)` in `src/index.ts` cannot produce an unhandled rejection.
- `installFatalHandlers(process, logger)` (entry point only): an unhandled rejection or uncaught exception is logged as
  `process.unhandled_rejection` / `process.uncaught_exception` through Stark's logger, which hides configured secrets,
  and the process exits with 1. Before, Node.js printed the raw error to stderr (unredacted) and exited the same way.
  Chosen over "log and keep running" because an error nothing expected may leave state inconsistent; systemd restarts
  Stark after 5 s (D-66).

## Verification

- New tests, failing on the old code: `test/interface/http.test.ts` "answers 400 to a request target that is not a
  valid URL, and keeps serving" (old: `TypeError: Invalid URL` as an unhandled error, request hangs) and "never
  rejects, even when the response cannot be written" (old: rejected with the write error); `test/index.test.ts`
  "logs an unhandled rejection … then exits with 1" (old: no such function) and "is installed on the process only when
  the entry point asks for it".
- Control runs, each turning one test red: rethrowing the URL error; removing the outer boundary; not exiting after a
  rejection; not installing the handlers; installing them always.
- P-05 and P-06 against a build of the change on Node v24.22.2: raw `GET http://a:99999/` → `HTTP/1.1 400 Bad Request`;
  `curl --path-as-is …//` → 400; Chromium `goto(…//)` → 400; the server kept running.
- `npm run check` with PostgreSQL: see the commit.

## Re-audit of the affected area (MSAP §29)

- F-101: the mechanism (URL parsed outside the boundary, rejection unhandled) no longer exists, and the three probe
  forms are answered. **F-101: RESOLVED.**
- Residual, outside the scope: none found on this path. F-103, F-104 and F-108 on the same page are unchanged.
