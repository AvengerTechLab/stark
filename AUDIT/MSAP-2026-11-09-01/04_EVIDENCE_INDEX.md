# 04 — Evidence index

Paths are relative to the subject at `289e243` unless marked `logs/` or `probes/` (this audit folder). Line numbers
are at `289e243`.

| ID | Evidence | Supports |
|---|---|---|
| E-101 | `src/interface/http-server.ts` L221-223 (`new URL(...)` before `try`); `src/index.ts` L86 (`void handler(req, res)`); no `unhandledRejection` in `src/` (grep) | F-101 |
| E-102 | P-05 `probes/p05-crash.mjs` + `logs/15-p05-server.txt`: raw `GET http://a:99999/ HTTP/1.1` → `TypeError: Invalid URL`, exit 1 (Node v24.22.2) | F-101 |
| E-103 | P-06 `logs/17-p06-server.txt` (curl `--path-as-is //` → exit 1), `logs/17-p06-server-b.txt` (Chromium `page.goto("http://localhost:PORT//")` → `ERR_EMPTY_RESPONSE`, server exit 1) | F-101 |
| E-104 | `src/storage/postgres.ts` L170-176 (`priceAtOrBefore`, no lower bound); `src/app/pipeline.ts` L112-119; `src/domain/message.ts` L56; `EVENTS.md` §3.3 step 2, §3.5; `stark_volume` query with cutoff 2026-11-20 → 2026-11-08 23:59:59 tick | F-102 |
| E-105 | P-03 `test/audit-probes/http-probes.test.ts` (export) + `logs/10-http-probes.txt`: 30 parallel wrong → `{"401":12,"429":18}`, 12 failures recorded | F-103 |
| E-106 | `http-server.ts` L133-156 (lock read before verify, notice per failure) | F-103 |
| E-107 | `postgres.ts` session store (`DELETE` only by id hash; `isValid` = hash + expiry); `http-server.ts` L181; `deploy/WEB.md` (change the password at once) | F-104 |
| E-108 | P-07 `test/audit-probes/p07-silent-cycle.test.ts` + `logs/18-p07.txt`: 60 sockets, 118 polls, 118 ticks, longest gap 60 s in one fake hour; `stream-feed.ts` L109-158; `health.ts` L104-111 | F-105 |
| E-109 | `src/index.ts` L30-46 (race, default pool); `health.ts` L288-302; `stark.ts` L76-91 | F-106 |
| E-110 | Lock chain on PostgreSQL 16 (`stark_volume`): ACCESS SHARE 8 s → `CREATE TABLE … PARTITION OF` 7.0 s → INSERT 6.0 s; `postgres.ts` L111-142; `stark.ts` L192; `pipeline.ts` L38, L76; `deploy/stark-backup.timer` | F-107 |
| E-111 | P-04 (`logs/10-http-probes.txt`): `Host: evil.example:8080` + matching Origin → login 401, `/healthz` 200; `http-server.ts` L77-82 | F-108 |
| E-112 | `src/app/stark.ts` L133-136; `pipeline.ts` L47-53, L89-92 | F-109 |
| E-113 | `src/feeds/binance.ts` L44-45; `new Date(9999999999999999)` → Invalid Date (Node 24); `pipeline.ts` L44-57 | F-110 |
| E-114 | `stark.ts` L95-96, L190; `src/feeds/pairs.ts` L55-57; `src/app/owner-service.ts` L57, L84 | F-111 |
| E-115 | `src/interface/telegram-bot.ts` L107-111; Bot API `getUpdates` "offset" (read 2026-11-04) | F-112 |
| E-116 | `stream-feed.ts` L76-80, L161-169; `src/feeds/node-network.ts` L11 | F-113 |
| E-117 | `stream-feed.ts` L186-195; `pipeline.ts` L55 | F-114 |
| E-118 | `health.ts` L298; `src/app/dispatcher.ts` L137 | F-115 |
| E-119 | `.gitignore`; `deploy/SETUP.md` §7, §10 (rsync, `npm ci` as root); `deploy/BACKUP.md` §1 | F-116 |
| E-120 | `deploy/stark.service`, `deploy/stark-backup.service` | F-117 |
| E-121 | `deploy/WEB.md` (ask Claude for a hash); `src/interface/password.ts` L7; `src/config.ts` | F-118 |
| E-122 | `logs/06-test-shuffle.txt`, `logs/06-shuffle-{1..8}.txt`: seeds 6, 7, 12345 fail the same 2 tests in `test/storage/postgres.test.ts`; `logs/06-test-db-{1..10}.txt` all 298 passed; `logs/06-test-tz.txt` (TZ=America/New_York) 298 passed | F-119 |
| E-123 | `logs/08-mutation.txt`, `logs/08-mutation-report.json`: score 76.94 %, survivors at `rules.ts` L70, L98, `dispatcher.ts` L89, `rule-input.ts` L90 | F-119 |
| E-124 | `logs/07-coverage.txt`: 92.05 % statements, 89.32 % branches; `index.ts` 34.84 %, `node-network.ts` 39.13 %, `backup/main.ts` 46.66 % | F-119, F-012 |
| E-125 | Reviewer reports `logs/14-reviewer-correctness.md`, `logs/16-reviewer-security.md`, `logs/19-reviewer-reliability.md` (items checked by the lead as noted there) | F-120 |
| E-126 | `logs/12-volume-load.txt`, `logs/13-volume-query.txt`: 12,096,000 demo ticks (4 pairs × 1/s × 35 days) in 2 min 11 s; 2,561 MB (heap 1,099 MB, indexes 1,461 MB); reference lookup 0.29–0.71 ms (planning 5–7 ms over 37 partitions); `pg_dump` 1,430,445,929 bytes in 13.4 s, gzip −1 416,383,652 bytes | F-010, health |
| E-127 | `logs/11-a1-probes.txt`: P-01 no longer reproduces; P-02 still reproduces | F-001, F-009 |
| E-128 | `logs/02-lint.txt`, `03-tsc.txt`, `04-build.txt` exit 0; `logs/05-audit.txt` high: 0; production audit 0 | Health |
| E-129 | `logs/09-history.patch` (all 111 commits): only fake tokens, a fake webhook, fake DB URLs and test hashes; no private key, no Google secret, no R2 account ID; the VPS IP (17 matches) and restic repo ID are present (not secrets) | Security |
| E-130 | VPS read-only output from the PO (05) | Mode C |
