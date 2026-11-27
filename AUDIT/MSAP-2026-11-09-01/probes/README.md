# Probes of MSAP-2026-11-09-01

Run on fakes or a throwaway PostgreSQL only; they observe behaviour and change nothing. They are a record, not part of
the test run (vitest includes `test/**` only).

| File | Probe | How it was run |
|---|---|---|
| `http-probes.ts` | P-03 parallel wrong passwords; P-04 foreign Host | copied to `test/audit-probes/*.test.ts` in an export of `289e243`, `vitest run` |
| `p05-crash.mjs` | P-05/P-06 server wired as `src/index.ts`; then a raw invalid target, `curl --path-as-is …//`, or Chromium `goto(…//)` | `node p05-crash.mjs` beside a `build/` of `289e243` |
| `p07-silent-cycle.ts` | P-07 every socket opens and stays silent for one fake hour | as `http-probes.ts` |
| `volume-setup.mjs`, `volume-load.sql` | 35 days × 4 demo pairs × 1 tick/s in a throwaway database | `node volume-setup.mjs`, then `psql -f volume-load.sql` |

The A-1 probes P-01 and P-02 are in `AUDIT/MSAP-2026-11-04-01/probes/`.
