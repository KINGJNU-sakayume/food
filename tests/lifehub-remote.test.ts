import test from "node:test";
import assert from "node:assert/strict";
import { emptyArchive } from "../src/lib/data.js";
import { approveCandidate } from "../src/lib/lifehub-approval.js";
import { addLocalCandidate, readLocalInbox, rejectLocalCandidate } from "../src/lib/lifehub-local.js";
import {
  beginConnect, completeConnect, connectAvailable, disconnect, isAuthCallback, isConnected,
  LifeHubError, remoteOutcomes, syncWithLifeHub, type RemoteDeps,
} from "../src/lib/lifehub-remote.js";
import { LIFEHUB_CLIENT_ID, LIFEHUB_ORIGIN, LIFEHUB_RESOURCE, PALATE_APP_URL } from "../src/lib/lifehub-config.js";

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}
const synthetic = (key: string, type: "meal" | "wish" = "meal") => ({
  schema_version: 1, source: "claude", source_ref: "claude-mcp:2026-11-02", idempotency_key: key,
  created_at: "2026-11-02T01:00:00.000Z", candidate_type: type,
  payload: type === "meal" ? { menu_name: "가상 컵라면", eaten_at: "2026-11-02", note: "브런치" } : { wish_kind: "try_menu", name: "가상 파스타" },
});

/** In-memory Life Hub: token endpoint + PALATE API, with switches to simulate failures. */
function fakeHub() {
  const hub = {
    candidates: new Map<string, { status: string; candidate: ReturnType<typeof synthetic>; entity?: string }>(),
    issued: 0, refreshes: 0, calls: [] as string[],
    offline: false, failNext: 0, revokeAll: false, expiresIn: 3600, lastTokenForm: null as URLSearchParams | null,
    access: new Set<string>(), refresh: new Set<string>(),
  };
  const issue = () => {
    const n = ++hub.issued;
    hub.access.add("at" + n); hub.refresh.add("rt" + n);
    return { access_token: "at" + n, refresh_token: "rt" + n, token_type: "bearer", expires_in: hub.expiresIn, scope: "food:inbox" };
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (hub.offline) throw new TypeError("Failed to fetch");
    const url = new URL(String(input));
    hub.calls.push((init?.method ?? "GET") + " " + url.pathname);
    if (url.origin !== LIFEHUB_ORIGIN) return json(404, {});
    if (url.pathname === "/oauth/token") {
      const form = new URLSearchParams(String(init?.body));
      hub.lastTokenForm = form;
      if (form.get("client_id") !== LIFEHUB_CLIENT_ID) return json(401, { error: "invalid_client" });
      if (form.has("token") && !form.has("grant_type")) return new Response(null, { status: 200 });
      if (form.get("grant_type") === "authorization_code") return json(200, issue());
      if (form.get("grant_type") === "refresh_token") {
        if (hub.revokeAll || !hub.refresh.has(form.get("refresh_token")!)) return json(400, { error: "invalid_grant" });
        hub.refresh.delete(form.get("refresh_token")!); hub.refreshes++;
        return json(200, issue());
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    const auth = new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "");
    if (!auth || !hub.access.has(auth)) return json(401, { error: "invalid_token" });
    if (hub.failNext > 0) { hub.failNext--; return json(503, { error: "unavailable" }); }
    if (url.pathname === "/palate/v1/candidates") {
      const list = [...hub.candidates.entries()].filter(([, v]) => v.status === "pending")
        .map(([key, v]) => ({ key, status: v.status, candidate: v.candidate }));
      return json(200, { candidates: list });
    }
    const body = JSON.parse(String(init?.body)) as { key: string; entity_type?: string; entity_id?: string };
    const found = hub.candidates.get(body.key);
    if (!found) return json(404, { error: "Candidate not found" });
    if (url.pathname === "/palate/v1/receipts") {
      if (found.status === "rejected" || (found.status === "confirmed" && found.entity !== body.entity_id)) return json(409, { error: "conflict" });
      found.status = "confirmed"; found.entity = body.entity_id; return json(200, {});
    }
    if (url.pathname === "/palate/v1/rejections") {
      if (found.status === "confirmed") return json(409, { error: "conflict" });
      found.status = "rejected"; return json(200, {});
    }
    return json(404, {});
  }) as typeof fetch;
  return { hub, fetchImpl };
}
function makeDeps(fetchImpl: typeof fetch, clock = { t: Date.parse("2026-11-02T01:00:00Z") }): RemoteDeps & { clock: typeof clock } {
  let counter = 0;
  return {
    fetch: fetchImpl, storage: new MemoryStorage(), session: new MemoryStorage(), clock,
    now: () => clock.t,
    random: (n) => Uint8Array.from({ length: n }, () => (counter++ * 37 + 11) % 256),
    sha256: async (d) => new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(d))),
  };
}
async function connected(fetchImpl: typeof fetch) {
  const deps = makeDeps(fetchImpl);
  const url = new URL(await beginConnect(deps));
  await completeConnect(`?code=c1&state=${url.searchParams.get("state")}&iss=${encodeURIComponent(LIFEHUB_ORIGIN)}`, deps);
  return deps;
}

test("connect builds an S256 PKCE request for the PALATE resource and exchanges the code", async () => {
  const { hub, fetchImpl } = fakeHub();
  const deps = makeDeps(fetchImpl);
  const url = new URL(await beginConnect(deps));
  assert.equal(url.origin + url.pathname, LIFEHUB_ORIGIN + "/authorize");
  assert.equal(url.searchParams.get("client_id"), LIFEHUB_CLIENT_ID);
  assert.equal(url.searchParams.get("redirect_uri"), PALATE_APP_URL);
  assert.equal(url.searchParams.get("resource"), LIFEHUB_RESOURCE);
  assert.equal(url.searchParams.get("scope"), "food:inbox");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(isConnected(deps), false);

  await completeConnect(`?code=abc&state=${url.searchParams.get("state")}`, deps);
  assert.equal(isConnected(deps), true);
  const verifier = hub.lastTokenForm!.get("code_verifier")!;
  const expected = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
  assert.equal(url.searchParams.get("code_challenge"), expected);
  assert.equal(hub.lastTokenForm!.get("resource"), LIFEHUB_RESOURCE);
  // The pending request is single-use.
  await assert.rejects(completeConnect(`?code=abc&state=${url.searchParams.get("state")}`, deps), (e: LifeHubError) => e.kind === "state");
});

test("callbacks with a wrong state, wrong issuer, denial or an old request do not connect", async () => {
  const { fetchImpl } = fakeHub();
  const cases: Array<[(state: string) => string, string, number?]> = [
    [(s) => `?code=x&state=${s}x`, "state"],
    [(s) => `?code=x&state=${s}&iss=${encodeURIComponent("https://evil.example")}`, "state"],
    [(s) => `?error=access_denied&state=${s}`, "denied"],
    [(s) => `?code=x&state=${s}`, "state", 11 * 60 * 1000],
  ];
  for (const [query, kind, delay] of cases) {
    const deps = makeDeps(fetchImpl);
    const state = new URL(await beginConnect(deps)).searchParams.get("state")!;
    deps.clock.t += delay ?? 0;
    await assert.rejects(completeConnect(query(state), deps), (e: LifeHubError) => e.kind === kind);
    assert.equal(isConnected(deps), false);
  }
  assert.equal(isAuthCallback("?code=a&state=b"), true);
  assert.equal(isAuthCallback("?state=b&error=access_denied"), true);
  assert.equal(isAuthCallback("?text=hello"), false);
});

test("sync pulls pending candidates into the local inbox without creating records", async () => {
  const { hub, fetchImpl } = fakeHub();
  hub.candidates.set("claude:mcp-meal-0001", { status: "pending", candidate: synthetic("mcp-meal-0001") });
  hub.candidates.set("claude:mcp-wish-0001", { status: "pending", candidate: synthetic("mcp-wish-0001", "wish") });
  const deps = await connected(fetchImpl);
  const archive = emptyArchive();
  const first = await syncWithLifeHub(archive, deps);
  assert.equal(first.imported, 2);
  assert.equal(archive.records.length, 0);
  assert.equal(readLocalInbox(archive, deps.storage).filter((e) => e.status === "pending").length, 2);
  const again = await syncWithLifeHub(archive, deps);
  assert.equal(again.imported, 0);
  assert.equal(readLocalInbox(archive, deps.storage).length, 2);
});

test("approvals and rejections are sent once, retried after failures, and conflicts stop retrying", async () => {
  const { hub, fetchImpl } = fakeHub();
  hub.candidates.set("claude:mcp-meal-0001", { status: "pending", candidate: synthetic("mcp-meal-0001") });
  hub.candidates.set("claude:mcp-wish-0001", { status: "pending", candidate: synthetic("mcp-wish-0001", "wish") });
  hub.candidates.set("claude:mcp-meal-0002", { status: "pending", candidate: synthetic("mcp-meal-0002") });
  const deps = await connected(fetchImpl);
  let archive = emptyArchive();
  await syncWithLifeHub(archive, deps);

  const entry = readLocalInbox(archive, deps.storage).find((e) => e.key === "claude:mcp-meal-0001")!;
  const approved = approveCandidate(archive, entry.candidate, { candidate_type: "meal", menu_name: "가상 컵라면", place_name: "",
    address: "", eaten_at: "2026-11-02", verdict: "LIKE", reorder_intent: "MAYBE", note: "브런치" });
  archive = approved.archive;
  rejectLocalCandidate(archive, "claude:mcp-wish-0001", deps.storage);
  // Life Hub changed its mind about the third one: PALATE's later approval conflicts.
  const third = readLocalInbox(archive, deps.storage).find((e) => e.key === "claude:mcp-meal-0002")!;
  archive = approveCandidate(archive, third.candidate, { candidate_type: "meal", menu_name: "x", place_name: "", address: "",
    eaten_at: "2026-11-02", verdict: "NEUTRAL", reorder_intent: "NO", note: "" }).archive;
  hub.candidates.get("claude:mcp-meal-0002")!.status = "rejected";

  hub.failNext = 1; // first outbox call fails, the rest succeed
  const s1 = await syncWithLifeHub(archive, deps);
  assert.equal(s1.waiting, 1);
  const s2 = await syncWithLifeHub(archive, deps);
  assert.equal(hub.candidates.get("claude:mcp-meal-0001")!.status, "confirmed");
  assert.equal(hub.candidates.get("claude:mcp-meal-0001")!.entity, approved.entity_id);
  assert.equal(hub.candidates.get("claude:mcp-wish-0001")!.status, "rejected");
  assert.equal(s1.receiptsSent + s2.receiptsSent, 1);
  assert.equal(s1.rejectionsSent + s2.rejectionsSent, 1);
  assert.equal(s2.conflicts, 1);
  const outcomes = remoteOutcomes(archive, deps);
  assert.equal(outcomes["claude:mcp-meal-0002"], "conflict");
  // The local record is kept regardless of the conflict.
  assert.equal(archive.records.length, 2);

  const posts = hub.calls.filter((c) => c.startsWith("POST /palate")).length;
  await syncWithLifeHub(archive, deps);
  assert.equal(hub.calls.filter((c) => c.startsWith("POST /palate")).length, posts, "nothing is re-sent");
});

test("manually imported candidates are never sent to Life Hub", async () => {
  const { hub, fetchImpl } = fakeHub();
  const deps = await connected(fetchImpl);
  const archive = emptyArchive();
  const manual = { ...synthetic("manual-key-0001"), source: "manual" };
  addLocalCandidate(archive, manual, deps.storage);
  rejectLocalCandidate(archive, "manual:manual-key-0001", deps.storage);
  await syncWithLifeHub(archive, deps);
  assert.equal(hub.calls.filter((c) => c.startsWith("POST /palate")).length, 0);
});

test("expired access tokens refresh; a revoked grant disconnects; offline is a network error", async () => {
  const { hub, fetchImpl } = fakeHub();
  hub.expiresIn = 120;
  const deps = await connected(fetchImpl);
  const archive = emptyArchive();
  deps.clock.t += 5 * 60 * 1000;
  await syncWithLifeHub(archive, deps);
  assert.equal(hub.refreshes, 1);

  hub.offline = true;
  await assert.rejects(syncWithLifeHub(archive, deps), (e: LifeHubError) => e.kind === "network");
  assert.equal(isConnected(deps), true);
  hub.offline = false;

  hub.access.clear(); hub.revokeAll = true;
  await assert.rejects(syncWithLifeHub(archive, deps), (e: LifeHubError) => e.kind === "not_connected");
  assert.equal(isConnected(deps), false);
});

test("disconnect forgets tokens locally and asks Life Hub to revoke", async () => {
  const { hub, fetchImpl } = fakeHub();
  const deps = await connected(fetchImpl);
  disconnect(deps);
  assert.equal(isConnected(deps), false);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(hub.lastTokenForm!.has("token"));
});

test("connecting is only offered on the deployed PALATE address", () => {
  const app = new URL(PALATE_APP_URL);
  assert.equal(connectAvailable({ origin: app.origin, pathname: app.pathname }), true);
  assert.equal(connectAvailable({ origin: app.origin, pathname: app.pathname + "index.html" }), true);
  assert.equal(connectAvailable({ origin: "http://localhost:5173", pathname: "/" }), false);
});
