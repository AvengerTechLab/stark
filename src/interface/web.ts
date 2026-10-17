// The owner web page (API.md §1, SPEC.md D-21): one HTML page, one script and one style sheet, served by
// the Stark process. No inline script or style, so the Content-Security-Policy can forbid both
// (SECURITY.md T-05); every value from the API is written with textContent, never as HTML.

export const INDEX_HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stark</title>
<link rel="stylesheet" href="/app.css">
<script src="/app.js" defer></script>
</head>
<body>
<header><h1>Stark</h1><button id="logout" hidden>ออกจากระบบ</button></header>
<main>
<section id="login">
<h2>เข้าสู่ระบบ</h2>
<form id="login-form">
<label>รหัสผ่าน <input type="password" id="password" autocomplete="current-password" required></label>
<button type="submit">เข้าสู่ระบบ</button>
</form>
</section>
<div id="app" hidden>
<section><h2>ราคาล่าสุด</h2><table id="prices"></table></section>
<section><h2>กฎแจ้งเตือน</h2>
<form id="rule-form">
<label>ชนิด <select id="kind"><option value="above">ราคา ≥</option><option value="below">ราคา ≤</option><option value="change">เปลี่ยนเป็น %</option></select></label>
<label>คู่เหรียญ <input id="pair" placeholder="BTC/THB" required></label>
<label class="level">ราคา <input id="level" inputmode="decimal"></label>
<label class="change">เปอร์เซ็นต์ <input id="percent" inputmode="decimal"></label>
<label class="change">นาที <input id="window" inputmode="numeric"></label>
<label class="change">ทิศทาง <select id="direction"><option value="up">ขึ้น</option><option value="down">ลง</option><option value="either">ขึ้นหรือลง</option></select></label>
<fieldset id="rule-channels"><legend>ช่องทาง</legend></fieldset>
<button type="submit">เพิ่มกฎ</button>
</form>
<table id="rules"></table>
</section>
<section><h2>ช่องทางแจ้งเตือน</h2><table id="channels"></table></section>
<section><h2>สุขภาพระบบ</h2><pre id="health"></pre></section>
<section><h2>การแจ้งเตือนย้อนหลัง 24 ชั่วโมง</h2><table id="alerts"></table></section>
</div>
<p id="message" role="status"></p>
</main>
</body>
</html>
`;

export const APP_CSS = `body{font-family:system-ui,sans-serif;margin:0 auto;max-width:60rem;padding:1rem;line-height:1.4}
header{display:flex;justify-content:space-between;align-items:center}
table{border-collapse:collapse;width:100%;margin:.5rem 0}
td,th{border-bottom:1px solid #ccc;padding:.3rem;text-align:left;vertical-align:top}
form label{display:inline-block;margin:.2rem .6rem .2rem 0}
fieldset{display:inline-block;border:1px solid #ccc}
#message{min-height:1.5rem;color:#a00}
pre{white-space:pre-wrap}
[hidden]{display:none}
`;

export const APP_JS = `"use strict";
const CHANNELS = ["telegram", "line", "discord", "email"];
const $ = (id) => document.getElementById(id);
const say = (text) => { $("message").textContent = text; };

async function api(method, path, body) {
  const options = { method, headers: {}, credentials: "same-origin" };
  if (body !== undefined) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  if (response.status === 401) { show(false); throw new Error("UNAUTHENTICATED"); }
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) {
    const details = (data.error && data.error.details) || [];
    throw new Error(details.length > 0 ? details.map((d) => d.field + ": " + d.code).join(", ") : data.error.code);
  }
  return data;
}

function show(loggedIn) {
  $("login").hidden = loggedIn;
  $("app").hidden = !loggedIn;
  $("logout").hidden = !loggedIn;
}

function row(table, cells, header) {
  const tr = document.createElement("tr");
  for (const cell of cells) {
    const td = document.createElement(header ? "th" : "td");
    if (cell instanceof Node) td.append(cell); else td.textContent = cell === null || cell === undefined ? "" : String(cell);
    tr.append(td);
  }
  table.append(tr);
}

function button(label, action) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", () => action().then(load).catch((e) => say(e.message)));
  return b;
}

function condition(rule) {
  if (rule.kind === "above") return "ราคา ≥ " + rule.level;
  if (rule.kind === "below") return "ราคา ≤ " + rule.level;
  const words = { up: "ขึ้น", down: "ลง", either: "ขึ้นหรือลง" };
  return words[rule.direction] + " ≥ " + rule.percent + "% ใน " + rule.windowMinutes + " นาที";
}

async function load() {
  const [prices, rules, channels, health, alerts] = await Promise.all([
    api("GET", "/api/v1/prices"), api("GET", "/api/v1/rules"), api("GET", "/api/v1/channels"),
    api("GET", "/api/v1/health"), api("GET", "/api/v1/alerts"),
  ]);
  const p = $("prices"); p.replaceChildren();
  row(p, ["คู่เหรียญ", "ราคา", "ตลาด", "อายุ (วินาที)"], true);
  for (const x of prices) row(p, [x.pair, x.price, x.exchange, x.ageSeconds]);

  const r = $("rules"); r.replaceChildren();
  row(r, ["ID", "คู่เหรียญ", "เงื่อนไข", "ช่องทาง", "สถานะ", ""], true);
  for (const x of rules) {
    const actions = document.createElement("span");
    actions.append(
      button(x.enabled ? "ปิด" : "เปิด", () => api("PATCH", "/api/v1/rules/" + x.id, { enabled: !x.enabled })),
      button("ลบ", () => (confirm("ลบกฎนี้?") ? api("DELETE", "/api/v1/rules/" + x.id) : Promise.resolve())),
    );
    row(r, [x.id.slice(0, 8), x.pair, condition(x), x.channels.join(", "), (x.enabled ? "เปิด" : "ปิด") + " / " + x.state, actions]);
  }

  const c = $("channels"); c.replaceChildren();
  row(c, ["ช่องทาง", "ตั้งค่าแล้ว", "สถานะ", "ใช้ไป", ""], true);
  for (const x of channels) {
    const state = x.deadSince ? "ใช้ไม่ได้แล้ว" : x.enabled ? "เปิด" : "ปิด";
    const usage = x.usage ? x.usage.sent + " / " + x.usage.limit : "";
    row(c, [x.name, x.configured ? "ใช่" : "ไม่", state, usage,
      button(x.enabled ? "ปิด" : "เปิด", () => api("PATCH", "/api/v1/channels/" + x.name, { enabled: !x.enabled }))]);
  }

  $("health").textContent = JSON.stringify(health, null, 2);

  const a = $("alerts"); a.replaceChildren();
  row(a, ["เวลา", "ข้อความ", "การส่ง"], true);
  for (const x of alerts) {
    row(a, [new Date(x.decision.decidedAt).toLocaleString("th-TH"), x.decision.message,
      x.attempts.map((t) => t.channel + " #" + t.attempt + " " + t.status + (t.reason ? " (" + t.reason + ")" : "")).join("\\n")]);
  }
  say("");
}

function ruleBody() {
  const kind = $("kind").value;
  const body = { kind, pair: $("pair").value.trim(), channels: [] };
  for (const name of CHANNELS) if ($("ch-" + name).checked) body.channels.push(name);
  if (kind === "change") {
    body.percent = $("percent").value.trim();
    body.windowMinutes = Number($("window").value);
    body.direction = $("direction").value;
  } else {
    body.level = $("level").value.trim();
  }
  return body;
}

function kindChanged() {
  const change = $("kind").value === "change";
  for (const el of document.querySelectorAll(".change")) el.hidden = !change;
  for (const el of document.querySelectorAll(".level")) el.hidden = change;
}

document.addEventListener("DOMContentLoaded", () => {
  const fieldset = $("rule-channels");
  for (const name of CHANNELS) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox"; box.id = "ch-" + name; box.checked = name === "telegram";
    label.append(box, " " + name);
    fieldset.append(label);
  }
  $("kind").addEventListener("change", kindChanged);
  kindChanged();
  $("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    api("POST", "/api/v1/session", { password: $("password").value })
      .then(() => { $("password").value = ""; show(true); return load(); })
      .catch((e) => say(e.message === "UNAUTHENTICATED" ? "รหัสผ่านไม่ถูกต้อง" : e.message));
  });
  $("rule-form").addEventListener("submit", (event) => {
    event.preventDefault();
    api("POST", "/api/v1/rules", ruleBody()).then(load).catch((e) => say(e.message));
  });
  $("logout").addEventListener("click", () => api("DELETE", "/api/v1/session").then(() => show(false)).catch(() => show(false)));
  api("GET", "/api/v1/rules").then(() => { show(true); return load(); }).catch(() => show(false));
});
`;
