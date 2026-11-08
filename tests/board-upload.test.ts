import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_ENABLED_KEY, BOARD_MIN_INTERVAL_MS, boardNeedsReconnect, clearBoardReconnect, runBoardUpload, setBoardUploadEnabled,
} from "../src/lib/board-upload.js";
import { isConnected, LifeHubError, TOKENS_KEY, type RemoteDeps } from "../src/lib/lifehub-remote.js";
import { LIFEHUB_ORIGIN } from "../src/lib/lifehub-config.js";
import { emptyArchive } from "../src/lib/data.js";
import type { Archive } from "../src/types/model.js";
import { sampleArchive } from "./board-fixture.js";

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}
type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function setup(opts: { connected?: boolean; on?: boolean } = {}) {
  const clock = { t: Date.parse("2026-11-08T03:00:00Z") };
  const calls: Array<{ method: string; path: string; auth: string | null; body?: string }> = [];
  const state = { replies: [] as Reply[], offline: false, refreshOk: true };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (state.offline) throw new TypeError("Failed to fetch");
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? "GET", path: url.pathname, auth: new Headers(init?.headers).get("Authorization"), body: init?.body as string | undefined });
    if (url.pathname === "/oauth/token")
      return state.refreshOk
        ? new Response(JSON.stringify({ access_token: "at2", refresh_token: "rt2", token_type: "bearer", expires_in: 3600 }), { status: 200 })
        : new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    const r = state.replies.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  const deps: RemoteDeps = {
    fetch: fetchImpl, storage: new MemoryStorage(), session: new MemoryStorage(), now: () => clock.t,
    random: (n) => new Uint8Array(n),
    sha256: async (d) => new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(d))),
  };
  if (opts.connected !== false)
    deps.storage.setItem(TOKENS_KEY, JSON.stringify({ access_token: "at1", access_expires_at: clock.t + 3_600_000, refresh_token: "rt1", connected_at: "2026-11-01T00:00:00.000Z" }));
  if (opts.on !== false) setBoardUploadEnabled(deps.storage, true);
  const puts = () => calls.filter((c) => c.method === "PUT");
  return { clock, deps, state, calls, puts };
}

test("stores the board with the app's token and a valid manifest", async () => {
  const { deps, puts } = setup();
  const out = await runBoardUpload(sampleArchive(), deps);
  assert.deepEqual(out, { kind: "sent", result: "stored" });
  assert.equal(puts().length, 1);
  assert.equal(puts()[0].path, "/palate/v1/board");
  assert.equal(puts()[0].auth, "Bearer at1");
  const body = JSON.parse(puts()[0].body!);
  assert.equal(body.app, "food"); assert.equal(body.version, 1);
  assert.equal(body.generated_at, "2026-11-08T03:00:00.000Z");
  assert.ok(body.tiles.length > 0);
});

test("unchanged and ignored answers are successes", async () => {
  for (const [body, result] of [[{ unchanged: true }, "unchanged"], [{ ignored: true }, "ignored"]] as const) {
    const { deps, state } = setup();
    state.replies.push({ status: 200, body });
    assert.deepEqual(await runBoardUpload(sampleArchive(), deps), { kind: "sent", result });
    assert.equal(boardNeedsReconnect(deps.storage), false);
  }
});

test("insufficient_scope keeps the token and asks for a reconnect", async () => {
  const { deps, state } = setup();
  state.replies.push({ status: 403, headers: { "WWW-Authenticate": 'Bearer error="insufficient_scope", scope="food:board"' } });
  assert.deepEqual(await runBoardUpload(sampleArchive(), deps), { kind: "reconnect_needed" });
  assert.equal(isConnected(deps), true);
  assert.equal(boardNeedsReconnect(deps.storage), true);
  clearBoardReconnect(deps.storage);
  assert.equal(boardNeedsReconnect(deps.storage), false);
});

test("any other 403 follows the existing rule: token removed", async () => {
  const { deps, state } = setup();
  state.replies.push({ status: 403 });
  await assert.rejects(runBoardUpload(sampleArchive(), deps), (e) => e instanceof LifeHubError && e.kind === "not_connected");
  assert.equal(isConnected(deps), false);
});

test("401 is retried once with a refreshed token; a second 401 disconnects", async () => {
  const a = setup();
  a.state.replies.push({ status: 401 }, { status: 200, body: {} });
  assert.equal((await runBoardUpload(sampleArchive(), a.deps)).kind, "sent");
  assert.deepEqual(a.puts().map((c) => c.auth), ["Bearer at1", "Bearer at2"]);
  const b = setup();
  b.state.replies.push({ status: 401 }, { status: 401 });
  await assert.rejects(runBoardUpload(sampleArchive(), b.deps), (e) => e instanceof LifeHubError && e.kind === "not_connected");
  assert.equal(isConnected(b.deps), false);
});

test("400 is logged and the same content is never resent", async () => {
  const { deps, state, puts, clock } = setup();
  const log = console.error; const logged: unknown[][] = []; console.error = (...x) => { logged.push(x); };
  try {
    state.replies.push({ status: 400, body: { error: "bad" } });
    assert.deepEqual(await runBoardUpload(sampleArchive(), deps), { kind: "rejected", status: 400 });
  } finally { console.error = log; }
  assert.equal(logged.length, 1);
  clock.t += BOARD_MIN_INTERVAL_MS + 1;
  assert.deepEqual(await runBoardUpload(sampleArchive(), deps), { kind: "skipped", reason: "rejected" });
  assert.equal(puts().length, 1);
  assert.equal(isConnected(deps), true);
});

test("network errors and 5xx retry later and keep the change pending", async () => {
  const { deps, state, clock, puts } = setup();
  state.offline = true;
  assert.deepEqual(await runBoardUpload(sampleArchive(), deps), { kind: "retry" });
  state.offline = false;
  state.replies.push({ status: 503 });
  clock.t += BOARD_MIN_INTERVAL_MS + 1;
  assert.deepEqual(await runBoardUpload(sampleArchive(), deps), { kind: "retry" });
  clock.t += BOARD_MIN_INTERVAL_MS + 1;
  assert.equal((await runBoardUpload(sampleArchive(), deps)).kind, "sent");
  assert.equal(puts().length, 2);
});

test("at most one send per 10 minutes, then a change goes out once the time is up", async () => {
  const { deps, clock, puts } = setup();
  const a = sampleArchive();
  await runBoardUpload(a, deps);
  a.records[0].verdict = "DISLIKE";
  clock.t += 60_000;
  const out = await runBoardUpload(a, deps);
  assert.equal(out.kind, "throttled");
  assert.equal(out.kind === "throttled" && out.waitMs, BOARD_MIN_INTERVAL_MS - 60_000);
  assert.equal(puts().length, 1);
  clock.t += BOARD_MIN_INTERVAL_MS;
  assert.equal((await runBoardUpload(a, deps)).kind, "sent");
  assert.equal(puts().length, 2);
});

test("same content (generated_at aside) is not sent, except once a day on app start", async () => {
  const { deps, clock, puts } = setup();
  const a = sampleArchive();
  await runBoardUpload(a, deps);
  clock.t += BOARD_MIN_INTERVAL_MS + 1;
  assert.deepEqual(await runBoardUpload(a, deps), { kind: "skipped", reason: "same" });
  clock.t += 23 * 3_600_000;
  assert.deepEqual(await runBoardUpload(a, deps, { startup: true }), { kind: "skipped", reason: "same" });
  clock.t += 2 * 3_600_000;
  assert.deepEqual(await runBoardUpload(a, deps), { kind: "skipped", reason: "same" });
  assert.equal((await runBoardUpload(a, deps, { startup: true })).kind, "sent");
  assert.equal(puts().length, 2);
});

test("a change held back by the 10-minute wait goes out at the next app start", async () => {
  const { deps, clock, puts } = setup();
  const a = sampleArchive();
  await runBoardUpload(a, deps);
  a.records[0].verdict = "DISLIKE";
  clock.t += 60_000;
  assert.equal((await runBoardUpload(a, deps)).kind, "throttled");
  // The app closes here; a new run (same storage) starts one minute later.
  clock.t += 60_000;
  assert.equal((await runBoardUpload(a, deps, { startup: true })).kind, "sent");
  assert.equal(puts().length, 2);
});

test("nothing is sent: switch off, not connected, example archive, no records", async () => {
  const off = setup({ on: false });
  assert.deepEqual(await runBoardUpload(sampleArchive(), off.deps), { kind: "skipped", reason: "off" });
  assert.equal(off.deps.storage.getItem(BOARD_ENABLED_KEY), null);
  const disc = setup({ connected: false });
  assert.deepEqual(await runBoardUpload(sampleArchive(), disc.deps), { kind: "skipped", reason: "not_connected" });
  const demo = setup();
  const d: Archive = { ...sampleArchive(), demo: true };
  assert.deepEqual(await runBoardUpload(d, demo.deps), { kind: "skipped", reason: "demo" });
  const none = setup();
  assert.deepEqual(await runBoardUpload(emptyArchive(), none.deps), { kind: "skipped", reason: "empty" });
  for (const s of [off, disc, demo, none]) assert.equal(s.calls.length, 0);
});
