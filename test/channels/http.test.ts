import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchPost, retryAfterSeconds } from "../../src/channels/http.js";

// A local HTTP server on 127.0.0.1 stands in for the channel's API; nothing leaves the machine.
describe("fetchPost", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        res.writeHead(429, { "Retry-After": "7", "Content-Type": "application/json" });
        res.end(JSON.stringify({ method: req.method, type: req.headers["content-type"], body }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("posts the headers and body and returns the status, Retry-After and body", async () => {
    const result = await fetchPost(`${base}/send`, { headers: { "content-type": "application/json" }, body: `{"a":1}` });
    expect(result.status).toBe(429);
    expect(result.retryAfter).toBe("7");
    expect(JSON.parse(result.body)).toEqual({ method: "POST", type: "application/json", body: `{"a":1}` });
  });
});

describe("retryAfterSeconds", () => {
  it("reads whole or fractional seconds, and nothing else", () => {
    expect(retryAfterSeconds("30")).toBe(30);
    expect(retryAfterSeconds("1.5")).toBe(1.5);
    for (const header of [null, "", "0", "-1", "Wed, 21 Oct 2026 07:28:00 GMT"]) expect(retryAfterSeconds(header)).toBeUndefined();
  });
});
