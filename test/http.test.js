import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "../src/http.js";

// fetch is stubbed on globalThis for every test in this file and restored
// afterwards — no network calls in this suite.

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

function stubFetch(handler) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (...args) => {
    calls++;
    return handler(...args);
  };
  return {
    callCount: () => calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("a 401 issues exactly one request and is not tagged recoverable", async () => {
  const stub = stubFetch(() => jsonResponse(401, { msg: "bad token" }));
  try {
    await assert.rejects(
      () => fetchJson("https://example.com/orders", { retries: 3, retryDelayMs: 0 }),
      (err) => {
        assert.notEqual(err.recoverable, true);
        return true;
      },
    );
    assert.equal(stub.callCount(), 1);
  } finally {
    stub.restore();
  }
});

test("a 404 is not tagged recoverable", async () => {
  const stub = stubFetch(() => jsonResponse(404, { msg: "not found" }));
  try {
    await assert.rejects(
      () => fetchJson("https://example.com/orders", { retries: 3, retryDelayMs: 0 }),
      (err) => {
        assert.notEqual(err.recoverable, true);
        return true;
      },
    );
    assert.equal(stub.callCount(), 1);
  } finally {
    stub.restore();
  }
});

test("a 503 with retries: 3 issues exactly four requests", async () => {
  const stub = stubFetch(() => jsonResponse(503, { msg: "unavailable" }));
  try {
    await assert.rejects(() =>
      fetchJson("https://example.com/candles", { retries: 3, retryDelayMs: 0 }),
    );
    assert.equal(stub.callCount(), 4);
  } finally {
    stub.restore();
  }
});

test("a 429 with retries: 3 issues exactly four requests", async () => {
  const stub = stubFetch(() => jsonResponse(429, { msg: "rate limited" }));
  try {
    await assert.rejects(() =>
      fetchJson("https://example.com/candles", { retries: 3, retryDelayMs: 0 }),
    );
    assert.equal(stub.callCount(), 4);
  } finally {
    stub.restore();
  }
});

test("a 408 is recoverable", async () => {
  const stub = stubFetch(() => jsonResponse(408, { msg: "timed out" }));
  try {
    await assert.rejects(
      () => fetchJson("https://example.com/candles", { retries: 3, retryDelayMs: 0 }),
      (err) => {
        assert.equal(err.recoverable, true);
        return true;
      },
    );
    assert.equal(stub.callCount(), 4);
  } finally {
    stub.restore();
  }
});

test("a network failure is still recoverable", async () => {
  const stub = stubFetch(() => {
    throw new Error("getaddrinfo ENOTFOUND example.com");
  });
  try {
    await assert.rejects(
      () => fetchJson("https://example.com/candles", { retries: 0 }),
      (err) => {
        assert.equal(err.recoverable, true);
        return true;
      },
    );
  } finally {
    stub.restore();
  }
});

test("a non-JSON body is still recoverable", async () => {
  const stub = stubFetch(() => ({
    ok: true,
    status: 200,
    text: async () => "<html>not json</html>",
  }));
  try {
    await assert.rejects(
      () => fetchJson("https://example.com/candles", { retries: 0 }),
      (err) => {
        assert.equal(err.recoverable, true);
        return true;
      },
    );
  } finally {
    stub.restore();
  }
});
