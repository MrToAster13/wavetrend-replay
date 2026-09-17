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

function spySleep() {
  const delays = [];
  const fn = async (ms) => {
    delays.push(ms);
  };
  return { fn, delays };
}

test("backoff delays before attempts two, three, four fall in the jittered ranges", async () => {
  const stub = stubFetch(() => jsonResponse(503, { msg: "unavailable" }));
  const sleepSpy = spySleep();
  try {
    await assert.rejects(() =>
      fetchJson("https://example.com/candles", {
        retries: 3,
        retryDelayMs: 400,
        sleep: sleepSpy.fn,
        random: () => 0.5, // midpoint of the jitter range, for a deterministic check
      }),
    );
    assert.equal(sleepSpy.delays.length, 3);
    const [first, second, third] = sleepSpy.delays;
    assert.ok(first >= 300 && first <= 500, `first delay ${first} out of range`);
    assert.ok(second >= 600 && second <= 1000, `second delay ${second} out of range`);
    assert.ok(third >= 1200 && third <= 2000, `third delay ${third} out of range`);
  } finally {
    stub.restore();
  }
});

test("backoff delay never exceeds the 10s cap, even at high attempt counts", async () => {
  const stub = stubFetch(() => jsonResponse(503, { msg: "unavailable" }));
  const sleepSpy = spySleep();
  try {
    await assert.rejects(() =>
      fetchJson("https://example.com/candles", {
        retries: 10,
        retryDelayMs: 400,
        sleep: sleepSpy.fn,
        random: () => 1, // top of the jitter range, the worst case for the cap
      }),
    );
    assert.equal(sleepSpy.delays.length, 10);
    for (const delay of sleepSpy.delays) {
      assert.ok(delay <= 10000, `delay ${delay} exceeded the cap`);
    }
    // attempts far past where the base alone (400 * 2**attempt) already
    // exceeds 10s must land exactly on the cap.
    assert.equal(sleepSpy.delays.at(-1), 10000);
  } finally {
    stub.restore();
  }
});

test("repeated runs at the same attempt number do not all produce the same delay", async () => {
  const stub = stubFetch(() => jsonResponse(503, { msg: "unavailable" }));
  // Deterministic "random" source: a fixed sequence fed one value per call,
  // so this asserts the delay tracks the injected source rather than
  // asserting on real Math.random and risking a one-in-a-thousand flake.
  const sequence = [0.1, 0.9];
  let i = 0;
  const fakeRandom = () => sequence[i++ % sequence.length];
  try {
    const sleepSpyA = spySleep();
    await assert.rejects(() =>
      fetchJson("https://example.com/candles", {
        retries: 1,
        retryDelayMs: 400,
        sleep: sleepSpyA.fn,
        random: fakeRandom,
      }),
    );
    i = 1; // second run draws the other value from the sequence
    const sleepSpyB = spySleep();
    await assert.rejects(() =>
      fetchJson("https://example.com/candles", {
        retries: 1,
        retryDelayMs: 400,
        sleep: sleepSpyB.fn,
        random: fakeRandom,
      }),
    );
    assert.notEqual(sleepSpyA.delays[0], sleepSpyB.delays[0]);
  } finally {
    stub.restore();
  }
});

test("a call with retries: 0 still sleeps zero times", async () => {
  const stub = stubFetch(() => jsonResponse(503, { msg: "unavailable" }));
  const sleepSpy = spySleep();
  try {
    await assert.rejects(() =>
      fetchJson("https://example.com/candles", {
        retries: 0,
        retryDelayMs: 400,
        sleep: sleepSpy.fn,
      }),
    );
    assert.equal(sleepSpy.delays.length, 0);
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
