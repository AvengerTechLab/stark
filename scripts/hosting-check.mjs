// Hosting check (ARCHITECTURE.md §8, TASKS.md S6-12): run on a candidate host before choosing it.
//   node scripts/hosting-check.mjs
// Read-only. It calls only the providers' public market-data endpoints: no API key, no account, and
// nothing is sent to any alert channel. It prints each check's HTTP status, or the time to the first
// stream message, and exits 1 if any check failed.

const TIMEOUT_MS = 10_000;

const REST = [
  ["Bitkub ticker (REST)", "https://api.bitkub.com/api/v3/market/ticker?sym=btc_thb"],
  ["Binance market-data ticker (REST)", "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT"],
  ["Binance exchange info (REST)", "https://data-api.binance.vision/api/v3/exchangeInfo?symbol=BTCUSDT"],
];

const STREAMS = [
  ["Bitkub ticker stream (WebSocket)", "wss://api.bitkub.com/websocket-api/market.ticker.thb_btc"],
  ["Binance trade stream (WebSocket)", "wss://data-stream.binance.vision/stream?streams=btcusdt@trade"],
];

const line = (text) => process.stdout.write(`${text}\n`);

async function rest(name, url) {
  const started = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    await response.arrayBuffer();
    const seconds = ((performance.now() - started) / 1000).toFixed(2);
    line(`${response.status === 200 ? "OK  " : "FAIL"} ${name}: HTTP ${response.status} in ${seconds} s`);
    return response.status === 200;
  } catch (error) {
    line(`FAIL ${name}: ${error instanceof Error ? error.name : "error"}`);
    return false;
  }
}

function stream(name, url) {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = new WebSocket(url);
    const done = (ok, text) => {
      clearTimeout(timer);
      line(`${ok ? "OK  " : "FAIL"} ${name}: ${text}`);
      socket.close();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false, `no message within ${TIMEOUT_MS / 1000} s`), TIMEOUT_MS);
    socket.addEventListener("message", () => done(true, `first message after ${((performance.now() - started) / 1000).toFixed(2)} s`));
    socket.addEventListener("error", () => done(false, "connection failed"));
  });
}

const results = [];
for (const [name, url] of REST) results.push(await rest(name, url));
for (const [name, url] of STREAMS) results.push(await stream(name, url));
line(results.every(Boolean) ? "All checks passed." : "Some checks failed: this host may not suit Stark.");
process.exitCode = results.every(Boolean) ? 0 : 1;
