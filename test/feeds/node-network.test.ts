import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchGet, realTimers } from "../../src/feeds/node-network.js";

// A local HTTP server on 127.0.0.1 stands in for the provider; nothing leaves the machine.
describe("fetchGet", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/limited") {
        res.writeHead(429, { "Retry-After": "30" }).end("");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(`[{"symbol":"BTC_THB","last":"1"}]`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("returns the status, Retry-After and body", async () => {
    expect(await fetchGet(`${base}/limited`)).toEqual({ status: 429, retryAfter: "30", body: "" });
    expect(await fetchGet(`${base}/ok`)).toEqual({ status: 200, retryAfter: null, body: `[{"symbol":"BTC_THB","last":"1"}]` });
  });
});

describe("realTimers", () => {
  it("runs a timer, and never runs a cancelled one", async () => {
    const ran: string[] = [];
    realTimers.set(5, () => ran.push("kept"));
    const cancel = realTimers.set(5, () => ran.push("cancelled"));
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ran).toEqual(["kept"]);
  });
});
