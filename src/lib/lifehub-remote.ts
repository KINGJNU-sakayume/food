/**
 * PALATE ↔ Life Hub connection (P2b).
 *
 * - Connect: OAuth 2.1 authorization code + PKCE (S256). The owner signs in on Life Hub; PALATE
 *   only ever receives a `food:inbox` token for the `/palate` resource.
 * - Pull: pending food candidates are validated by the PALATE contract and added to the local inbox.
 *   Nothing is written to Archive.records until the owner approves on the inbox page.
 * - Push: approvals are already committed with a receipt inside the Archive. Receipts and local
 *   rejections for candidates that came from Life Hub are sent back from an outbox and retried on
 *   every sync until Life Hub answers. The Archive receipt stays authoritative either way.
 *
 * Tokens live in this browser's localStorage (per device). Network, storage and crypto are
 * injected so the whole flow is testable without a browser.
 */
import type { Archive } from "../types/model.js";
import {
  LIFEHUB_CLIENT_ID, LIFEHUB_ORIGIN, LIFEHUB_RESOURCE, LIFEHUB_SCOPE, PALATE_APP_URL,
} from "./lifehub-config.js";
import { readLocalInbox, upsertRemoteLocalCandidate } from "./lifehub-local.js";
import { validateCandidate, type LifeHubCandidate } from "./lifehub-contract.js";
import { reviewFromCandidate } from "./lifehub-approval.js";

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface RemoteDeps {
  fetch: typeof fetch;
  storage: KV;
  session: KV;
  now: () => number;
  random: (bytes: number) => Uint8Array;
  sha256: (data: Uint8Array) => Promise<Uint8Array>;
}
export function browserDeps(): RemoteDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    storage: localStorage,
    session: sessionStorage,
    now: () => Date.now(),
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    sha256: async (d) => new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(d))),
  };
}

export type LifeHubErrorKind = "not_connected" | "denied" | "state" | "network" | "server";
export class LifeHubError extends Error {
  kind: LifeHubErrorKind;
  constructor(kind: LifeHubErrorKind, message: string) { super(message); this.kind = kind; }
}

const TOKENS_KEY = "palate.lifehub.remote.v1";
const PENDING_AUTH_KEY = "palate.lifehub.pending-auth.v1";
const remoteKeysKey = (userId: string) => "palate.lifehub.remote-keys.v1." + userId;
const outcomesKey = (userId: string) => "palate.lifehub.remote-outcomes.v1." + userId;
const AUTO_APPLY_KEY = "palate.lifehub.auto-apply.v1";
const AUTH_MAX_AGE_MS = 10 * 60 * 1000;

interface Tokens { access_token: string; access_expires_at: number; refresh_token: string; connected_at: string }
interface PendingAuth { state: string; verifier: string; created_at: number }
export type OutcomeState = "confirmed" | "rejected" | "conflict" | "missing";

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
function readJson<T>(store: KV, key: string): T | null {
  try { const raw = store.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}

/** True only on the deployed PALATE page, where the registered redirect URI can come back to. */
export function connectAvailable(locationLike: { origin: string; pathname: string }): boolean {
  const app = new URL(PALATE_APP_URL);
  return locationLike.origin === app.origin && (locationLike.pathname === app.pathname || locationLike.pathname === app.pathname + "index.html");
}
export function isConnected(deps: Pick<RemoteDeps, "storage">): boolean {
  return readJson<Tokens>(deps.storage, TOKENS_KEY)?.refresh_token !== undefined;
}
export function isAuthCallback(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.has("state") && (q.has("code") || q.has("error"));
}

/** Step 1: returns the Life Hub sign-in URL to navigate to. */
export async function beginConnect(deps: RemoteDeps): Promise<string> {
  const verifier = b64url(deps.random(32));
  const state = b64url(deps.random(16));
  const challenge = b64url(await deps.sha256(new TextEncoder().encode(verifier)));
  const pending: PendingAuth = { state, verifier, created_at: deps.now() };
  deps.session.setItem(PENDING_AUTH_KEY, JSON.stringify(pending));
  const q = new URLSearchParams({
    response_type: "code", client_id: LIFEHUB_CLIENT_ID, redirect_uri: PALATE_APP_URL,
    scope: LIFEHUB_SCOPE, state, code_challenge: challenge, code_challenge_method: "S256",
    resource: LIFEHUB_RESOURCE,
  });
  return LIFEHUB_ORIGIN + "/authorize?" + q.toString();
}

async function tokenRequest(deps: RemoteDeps, params: Record<string, string>): Promise<Tokens> {
  let response: Response;
  try {
    response = await deps.fetch(LIFEHUB_ORIGIN + "/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: LIFEHUB_CLIENT_ID, ...params }).toString(),
    });
  } catch { throw new LifeHubError("network", "Life Hub에 연결할 수 없어요. 네트워크를 확인해 주세요."); }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    if (body.error === "invalid_grant") {
      deps.storage.removeItem(TOKENS_KEY);
      throw new LifeHubError("not_connected", "Life Hub 연결이 만료됐어요. 다시 연결해 주세요.");
    }
    throw new LifeHubError("server", "Life Hub 인증 서버 오류 (" + response.status + ")");
  }
  if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string" || String(body.token_type).toLowerCase() !== "bearer")
    throw new LifeHubError("server", "Life Hub 응답 형식이 올바르지 않아요.");
  const previous = readJson<Tokens>(deps.storage, TOKENS_KEY);
  const tokens: Tokens = {
    access_token: body.access_token, refresh_token: body.refresh_token,
    access_expires_at: deps.now() + (typeof body.expires_in === "number" ? body.expires_in : 300) * 1000,
    connected_at: previous?.connected_at ?? new Date(deps.now()).toISOString(),
  };
  deps.storage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  return tokens;
}

/** Step 2: called on the redirect back to PALATE with ?code&state&iss (or ?error). */
export async function completeConnect(search: string, deps: RemoteDeps): Promise<void> {
  const q = new URLSearchParams(search);
  const pending = readJson<PendingAuth>(deps.session, PENDING_AUTH_KEY);
  deps.session.removeItem(PENDING_AUTH_KEY);
  if (!pending || q.get("state") !== pending.state || deps.now() - pending.created_at > AUTH_MAX_AGE_MS)
    throw new LifeHubError("state", "연결 요청이 만료됐거나 이 브라우저에서 시작되지 않았어요. 다시 연결해 주세요.");
  // RFC 9207: a present issuer must be the Life Hub we started with.
  if (q.has("iss") && q.get("iss") !== LIFEHUB_ORIGIN)
    throw new LifeHubError("state", "다른 서버의 응답이라 연결하지 않았어요.");
  if (q.has("error"))
    throw new LifeHubError("denied", q.get("error") === "access_denied" ? "Life Hub 연결을 거절했어요." : "Life Hub 연결에 실패했어요.");
  const code = q.get("code");
  if (!code) throw new LifeHubError("state", "인증 코드가 없어요.");
  await tokenRequest(deps, {
    grant_type: "authorization_code", code, redirect_uri: PALATE_APP_URL,
    code_verifier: pending.verifier, resource: LIFEHUB_RESOURCE,
  });
}

async function accessToken(deps: RemoteDeps, forceRefresh = false): Promise<string> {
  const tokens = readJson<Tokens>(deps.storage, TOKENS_KEY);
  if (!tokens?.refresh_token) throw new LifeHubError("not_connected", "Life Hub에 연결되어 있지 않아요.");
  if (!forceRefresh && tokens.access_expires_at - 60_000 > deps.now()) return tokens.access_token;
  return (await tokenRequest(deps, { grant_type: "refresh_token", refresh_token: tokens.refresh_token })).access_token;
}

async function api(deps: RemoteDeps, method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  const send = async (token: string) => {
    try {
      return await deps.fetch(LIFEHUB_ORIGIN + "/palate/v1" + path, {
        method,
        headers: { Authorization: "Bearer " + token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new LifeHubError("network", "Life Hub에 연결할 수 없어요. 네트워크를 확인해 주세요."); }
  };
  let response = await send(await accessToken(deps));
  if (response.status === 401) response = await send(await accessToken(deps, true));
  if (response.status === 401 || response.status === 403) {
    deps.storage.removeItem(TOKENS_KEY);
    throw new LifeHubError("not_connected", "Life Hub 연결이 더 이상 유효하지 않아요. 다시 연결해 주세요.");
  }
  return response;
}

export function disconnect(deps: RemoteDeps): void {
  const tokens = readJson<Tokens>(deps.storage, TOKENS_KEY);
  deps.storage.removeItem(TOKENS_KEY);
  // Best-effort RFC 7009 revocation; the local tokens are gone either way.
  if (tokens?.refresh_token)
    void deps.fetch(LIFEHUB_ORIGIN + "/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refresh_token, token_type_hint: "refresh_token", client_id: LIFEHUB_CLIENT_ID }).toString(),
    }).catch(() => undefined);
}

export function remoteKeys(archive: Archive, deps: Pick<RemoteDeps, "storage">): Set<string> {
  const list = readJson<string[]>(deps.storage, remoteKeysKey(archive.user.id));
  return new Set(Array.isArray(list) ? list.filter((k) => typeof k === "string") : []);
}
export function remoteOutcomes(archive: Archive, deps: Pick<RemoteDeps, "storage">): Record<string, OutcomeState> {
  const map = readJson<Record<string, OutcomeState>>(deps.storage, outcomesKey(archive.user.id));
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

/** 「Claude에서 승인된 항목 자동 반영」: on unless the owner turned it off on this device. */
export function autoApplyEnabled(deps: Pick<RemoteDeps, "storage">): boolean {
  return deps.storage.getItem(AUTO_APPLY_KEY) !== "off";
}
export function setAutoApply(deps: Pick<RemoteDeps, "storage">, on: boolean): void {
  if (on) deps.storage.removeItem(AUTO_APPLY_KEY); else deps.storage.setItem(AUTO_APPLY_KEY, "off");
}

export interface PushSummary { receiptsSent: number; rejectionsSent: number; waiting: number }
export interface SyncSummary extends PushSummary {
  imported: number; conflicts: number;
  /** Approved in a Claude card, complete, and allowed to be saved without asking (auto-apply on). */
  autoApply: Array<{ key: string; candidate: LifeHubCandidate }>;
  /** Approved in a Claude card but waiting for the owner in the inbox (needs review, incomplete, or auto-apply off). */
  approvedWaiting: number;
}

/** Sends receipts and local rejections Life Hub has not acknowledged yet. Idempotent. */
export async function pushOutcomes(archive: Archive, deps: RemoteDeps): Promise<PushSummary> {
  const userId = archive.user.id;
  const keys = remoteKeys(archive, deps);
  const outcomes = remoteOutcomes(archive, deps);
  const saveOutcomes = () => deps.storage.setItem(outcomesKey(userId), JSON.stringify(outcomes));
  const summary: PushSummary = { receiptsSent: 0, rejectionsSent: 0, waiting: 0 };
  const decide = async (key: string, response: Response, ok: OutcomeState) => {
    if (response.ok) outcomes[key] = ok;
    else if (response.status === 409) outcomes[key] = "conflict";
    else if (response.status === 404) outcomes[key] = "missing";
    else { summary.waiting++; return; }
    saveOutcomes();
  };
  for (const receipt of archive.lifehub_receipts || []) {
    if (!keys.has(receipt.key) || outcomes[receipt.key]) continue;
    const response = await api(deps, "POST", "/receipts", { key: receipt.key, entity_type: receipt.entity_type, entity_id: receipt.entity_id });
    await decide(receipt.key, response, "confirmed");
    if (response.ok) summary.receiptsSent++;
  }
  for (const entry of readLocalInbox(archive, deps.storage)) {
    if (entry.status !== "rejected" || !keys.has(entry.key) || outcomes[entry.key]) continue;
    const response = await api(deps, "POST", "/rejections", { key: entry.key });
    await decide(entry.key, response, "rejected");
    if (response.ok) summary.rejectionsSent++;
  }
  return summary;
}

/**
 * Push outcomes first (so Life Hub stops listing what PALATE already decided), then pull open candidates
 * (pending + approved in a Claude card). Each item uses the owner's edited version when there is one.
 * Nothing is saved here: approved items that may be saved without asking are returned in `autoApply`.
 * Safe to call repeatedly; every step is idempotent on both sides.
 */
export async function syncWithLifeHub(archive: Archive, deps: RemoteDeps): Promise<SyncSummary> {
  const userId = archive.user.id;
  const pushed = await pushOutcomes(archive, deps);
  const keys = remoteKeys(archive, deps);
  const summary: SyncSummary = { ...pushed, imported: 0, conflicts: 0, autoApply: [], approvedWaiting: 0 };

  const response = await api(deps, "GET", "/candidates?status=open&limit=100");
  if (!response.ok) throw new LifeHubError("server", "Life Hub 후보를 가져오지 못했어요 (" + response.status + ")");
  const body = await response.json().catch(() => null) as { candidates?: unknown } | null;
  if (!body || !Array.isArray(body.candidates)) throw new LifeHubError("server", "Life Hub 응답 형식이 올바르지 않아요.");
  const receipts = new Set((archive.lifehub_receipts || []).map(r => r.key));
  const autoOn = autoApplyEnabled(deps);
  for (const raw of body.candidates) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    let candidate: LifeHubCandidate;
    try { candidate = validateCandidate(item.final_candidate ?? item.candidate); } catch { continue; /* skip malformed items */ }
    const status = item.status === "approved" ? "approved" : item.status === "pending" ? "pending" : null;
    if (!status) continue;
    const revision = Number.isSafeInteger(item.revision) && (item.revision as number) >= 0 ? item.revision as number : 0;
    const needsReview = item.needs_app_review === true;
    try {
      const result = upsertRemoteLocalCandidate(archive, candidate, { revision, status, needs_app_review: needsReview }, deps.storage);
      keys.add(result.key);
      if (result.result === "inserted") summary.imported++;
      const local = result.entries.find(e => e.key === result.key);
      if (status !== "approved" || !local || local.status !== "pending" || receipts.has(result.key)) continue;
      if (autoOn && !needsReview && reviewFromCandidate(local.candidate)) summary.autoApply.push({ key: result.key, candidate: local.candidate });
      else summary.approvedWaiting++;
    } catch {
      // Same key and revision with different content: the local entry is kept and nothing is overwritten.
      summary.conflicts++;
    }
  }
  deps.storage.setItem(remoteKeysKey(userId), JSON.stringify([...keys]));
  summary.conflicts += Object.values(remoteOutcomes(archive, deps)).filter((v) => v === "conflict").length;
  return summary;
}
