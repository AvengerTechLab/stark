/* eslint-disable -- audit record of MSAP-2026-11-09-01, kept as it was run; not part of the build or tests */
// P-05 (audit MSAP-2026-11-09-01): a request whose target is not a valid URL, against the audited handler
// wired exactly as src/index.ts wires it. Loopback only; the server runs inside this child process.
import { createServer } from "node:http";
import { ownerHandler } from "../build/interface/http-server.js";
const handler = ownerHandler({ logger: { info() {}, warn() {}, error() {} } });
const server = createServer((req, res) => void handler(req, res));
server.listen(0, "127.0.0.1", () => console.log("PORT", server.address().port));
