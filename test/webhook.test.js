import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { createWebhook, webhookOptions, startupMessage } from "../src/webhook.js";
import { webhookNotice } from "../src/tui.js";

// A made-up secret. Never a real one.
const SECRET = "test-only-not-a-real-secret";

// Each test binds a loopback address on an ephemeral port and closes it.
async function withWebhook(opts, fn) {
  const webhook = createWebhook({ port: 0, ...opts });
  const bound = await webhook.listen();
  try {
    await fn(webhook, bound);
  } finally {
    await webhook.close();
  }
}

// Resolves { status, body }, or { error } when the server cuts the connection.
function send(bound, { method = "POST", path = "/alert", body = "" } = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: bound.address, port: bound.port, method, path, agent: false },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on("error", (error) => resolve({ error }));
    req.end(body);
  });
}

const json = (o) => JSON.stringify(o);

test("with no host option the webhook listens on 127.0.0.1 only", async () => {
  await withWebhook({}, async (webhook, bound) => {
    assert.equal(bound.address, "127.0.0.1");
    assert.ok(bound.port > 0);
  });
});

test("the host option binds the address it names", async () => {
  await withWebhook({ host: "127.0.0.2" }, async (webhook, bound) => {
    assert.equal(bound.address, "127.0.0.2");
  });
});

test("webhookOptions defaults the host to 127.0.0.1", () => {
  assert.equal(webhookOptions({}, {}).host, "127.0.0.1");
});

test("webhookOptions takes --host over WEBHOOK_HOST", () => {
  assert.equal(webhookOptions({}, { WEBHOOK_HOST: "10.0.0.5" }).host, "10.0.0.5");
  assert.equal(webhookOptions({ host: "10.0.0.6" }, { WEBHOOK_HOST: "10.0.0.5" }).host, "10.0.0.6");
});

test("webhookOptions reads the secret from WEBHOOK_SECRET and treats empty as unset", () => {
  assert.equal(webhookOptions({}, { WEBHOOK_SECRET: SECRET }).secret, SECRET);
  assert.equal(webhookOptions({}, { WEBHOOK_SECRET: "" }).secret, null);
  assert.equal(webhookOptions({}, {}).secret, null);
});

test("the startup line prints the address actually bound", async () => {
  await withWebhook({ host: "127.0.0.2" }, async (webhook, bound) => {
    const msg = startupMessage(bound, { secured: true });
    assert.match(msg, new RegExp(`http://127\\.0\\.0\\.2:${bound.port}/alert`));
    assert.doesNotMatch(msg, /localhost/);
  });
});

test("the startup line warns when no secret is set", () => {
  const open = startupMessage({ address: "127.0.0.1", port: 8787 }, { secured: false });
  assert.match(open, /WEBHOOK_SECRET/);
  assert.match(open, /any caller/i);
  const secured = startupMessage({ address: "127.0.0.1", port: 8787 }, { secured: true });
  assert.doesNotMatch(secured, /any caller/i);
});

test("the startup line brackets an IPv6 address", () => {
  assert.match(startupMessage({ address: "::1", port: 8787 }, { secured: true }), /http:\/\/\[::1\]:8787\/alert/);
});

test("green and red are accepted with no secret set", async () => {
  await withWebhook({}, async (webhook, bound) => {
    assert.equal((await send(bound, { body: json({ signal: "green", symbol: "BTCUSDT" }) })).status, 200);
    assert.equal(webhook.peek().signal, "green");
    assert.equal((await send(bound, { body: "red" })).status, 200);
    assert.equal(webhook.peek().signal, "red");
    assert.equal(webhook.count(), 2);
  });
});

test("green and red are accepted with the matching secret", async () => {
  await withWebhook({ secret: SECRET }, async (webhook, bound) => {
    assert.equal((await send(bound, { body: json({ signal: "green", secret: SECRET }) })).status, 200);
    assert.equal(webhook.peek().signal, "green");
    assert.equal((await send(bound, { body: json({ signal: "red", secret: SECRET }) })).status, 200);
    assert.equal(webhook.peek().signal, "red");
    assert.equal(webhook.count(), 2);
  });
});

test("a wrong or missing secret gets 401 and changes nothing", async () => {
  await withWebhook({ secret: SECRET }, async (webhook, bound) => {
    for (const body of [
      json({ signal: "green" }),
      json({ signal: "green", secret: "wrong" }),
      json({ signal: "green", secret: SECRET + "x" }),
      json({ signal: "green", secret: 12345 }),
      json(null),
    ]) {
      const res = await send(bound, { body });
      assert.equal(res.status, 401, body);
      assert.ok(!res.body.includes(SECRET));
    }
    assert.equal(webhook.peek(), null);
    assert.equal(webhook.count(), 0);
  });
});

test("a bare-word body is refused while a secret is set", async () => {
  await withWebhook({ secret: SECRET }, async (webhook, bound) => {
    assert.equal((await send(bound, { body: "green" })).status, 401);
    assert.equal(webhook.peek(), null);
    assert.equal(webhook.count(), 0);
  });
});

test("an oversized body is refused", async () => {
  await withWebhook({}, async (webhook, bound) => {
    const res = await send(bound, { body: json({ signal: "green", pad: "x".repeat(20_000) }) });
    // Only a 413, or the reset that follows it, counts as refused.
    assert.ok(
      res.status === 413 || ["ECONNRESET", "EPIPE"].includes(res.error?.code),
      `got ${res.status ?? res.error?.code}`,
    );
    assert.equal(webhook.peek(), null);
    assert.equal(webhook.count(), 0);
  });
});

test("a non-POST request or another path gets 404", async () => {
  await withWebhook({}, async (webhook, bound) => {
    assert.equal((await send(bound, { method: "GET" })).status, 404);
    assert.equal((await send(bound, { path: "/other", body: "green" })).status, 404);
    assert.equal(webhook.count(), 0);
  });
});

// ── Regression tests from the adversarial review ──

// Sends the body in two writes, so the server sees two chunks.
function sendInTwo(bound, first, second) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: bound.address, port: bound.port, method: "POST", path: "/alert", agent: false },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode }));
      },
    );
    req.on("error", (error) => resolve({ error }));
    req.write(first);
    setTimeout(() => req.end(second), 50);
  });
}

test("a non-ASCII secret split across two chunks is accepted", async () => {
  const secret = "s\u00e9cret-\u20ac-made-up";
  await withWebhook({ secret }, async (webhook, bound) => {
    const bytes = Buffer.from(json({ signal: "green", secret }), "utf8");
    const split = bytes.indexOf(0xc3) + 1; // between the two bytes of the e-acute
    const res = await sendInTwo(bound, bytes.subarray(0, split), bytes.subarray(split));
    assert.equal(res.status, 200);
    assert.equal(webhook.count(), 1);
  });
});

test("the live TUI notice keeps the bound address and the no-secret warning on screen", () => {
  const notice = webhookNotice(startupMessage({ address: "0.0.0.0", port: 8787 }, { secured: false }));
  assert.match(notice, /http:\/\/0\.0\.0\.0:8787\/alert/);
  assert.match(notice, /WEBHOOK_SECRET is not set/);
  assert.equal(webhookNotice(""), "");
});

// ELI-1198: two alerts before one take. The last one wins and says how many it replaced.
test("take returns the newest alert with the count of alerts it replaced", async () => {
  await withWebhook({}, async (webhook, bound) => {
    await send(bound, { body: json({ signal: "green", symbol: "BTCUSDT" }) });
    await send(bound, { body: json({ signal: "red", symbol: "BTCUSDT" }) });
    const sig = webhook.take();
    assert.equal(sig.signal, "red");
    assert.equal(sig.replaced, 1);
    await send(bound, { body: json({ signal: "green", symbol: "BTCUSDT" }) });
    assert.equal(webhook.take().replaced, 0);
  });
});

test("the README states which alert wins when two arrive before one closed bar", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /last (alert )?wins/i);
});
