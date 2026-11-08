/**
 * Uploads the board tiles (board-tiles.ts) to Life Hub: PUT /palate/v1/board, scope `food:board`.
 *
 * Own request function on purpose: lifehub-remote's `api` drops the Life Hub token on any 401/403, which
 * would also cut the inbox/sync connection when only the board scope is missing. Here a 403 with
 * `insufficient_scope` keeps the token and only asks the owner to reconnect.
 *
 * Rules: at most one send per 10 minutes; nothing is sent when the content (sha256 without
 * `generated_at`) equals the last success, except once a day on app start; a change that could not be
 * sent is remembered ("pending") and goes out on the next start. Not sent: not connected, switch off
 * on this device, example archive, or an archive with no meals and no wishes.
 */
import type { Archive } from "../types/model.js";
import { LIFEHUB_ORIGIN } from "./lifehub-config.js";
import { accessToken, isConnected, LifeHubError, readJson, TOKENS_KEY, type RemoteDeps } from "./lifehub-remote.js";
import { boardBodyForHash, buildBoardTiles } from "./board-tiles.js";

export const BOARD_ENABLED_KEY = "palate.board.upload.enabled.v1";
export const BOARD_STATE_KEY = "palate.board.upload.state.v1";
export const BOARD_MIN_INTERVAL_MS = 10 * 60 * 1000;
export const BOARD_DAILY_MS = 24 * 60 * 60 * 1000;

interface BoardState {
  /** sha256 of the last successfully uploaded body. */
  sha?: string;
  /** Time of the last success. */
  ok_at?: number;
  /** Time of the last attempt that reached Life Hub (success or not). */
  tried_at?: number;
  /** A tile-affecting change that is not uploaded yet. */
  pending?: boolean;
  /** Body Life Hub rejected as invalid (400/413): never resend the same content. */
  rejected_sha?: string;
  /** Life Hub said the token has no `food:board` scope. */
  reconnect?: boolean;
}
type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type BoardOutcome =
  | { kind: "skipped"; reason: "off" | "not_connected" | "demo" | "empty" | "same" | "rejected" }
  | { kind: "throttled"; waitMs: number }
  | { kind: "sent"; result: "stored" | "unchanged" | "ignored" }
  | { kind: "reconnect_needed" }
  | { kind: "rejected"; status: number }
  | { kind: "retry" };

/** This device's switch 「이 기기에서 보드에 올리기」: off unless the owner turned it on. */
export function boardUploadEnabled(storage: Pick<KV, "getItem">): boolean {
  try { return storage.getItem(BOARD_ENABLED_KEY) === "on"; } catch { return false; }
}
export function setBoardUploadEnabled(storage: KV, on: boolean): void {
  try { if (on) storage.setItem(BOARD_ENABLED_KEY, "on"); else storage.removeItem(BOARD_ENABLED_KEY); } catch { /* stays off */ }
}
const readState = (storage: KV): BoardState => {
  const s = readJson<BoardState>(storage, BOARD_STATE_KEY);
  return s && typeof s === "object" && !Array.isArray(s) ? s : {};
};
const writeState = (storage: KV, state: BoardState): void => {
  try { storage.setItem(BOARD_STATE_KEY, JSON.stringify(state)); } catch { /* the next run recomputes */ }
};
export function boardNeedsReconnect(storage: KV): boolean { return readState(storage).reconnect === true; }
export function boardLastUploadAt(storage: KV): number | undefined { return readState(storage).ok_at; }
/** Called after a new Life Hub sign-in: the token may now carry `food:board`, and a send may go out at once. */
export function clearBoardReconnect(storage: KV): void {
  const s = readState(storage);
  if (!s.reconnect) return;
  delete s.reconnect; delete s.tried_at;
  writeState(storage, s);
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function boardPut(deps: RemoteDeps, body: string): Promise<Response | "insufficient_scope"> {
  const send = async (token: string) => {
    try {
      return await deps.fetch(LIFEHUB_ORIGIN + "/palate/v1/board", {
        method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body,
      });
    } catch { throw new LifeHubError("network", "Life Hub에 연결할 수 없어요. 네트워크를 확인해 주세요."); }
  };
  let response = await send(await accessToken(deps));
  if (response.status === 401) response = await send(await accessToken(deps, true));
  // Check the missing scope first: it must not disconnect anything.
  if (response.status === 403 && /insufficient_scope/.test(response.headers.get("WWW-Authenticate") ?? "")) return "insufficient_scope";
  if (response.status === 401 || response.status === 403) {
    deps.storage.removeItem(TOKENS_KEY);
    throw new LifeHubError("not_connected", "Life Hub 연결이 더 이상 유효하지 않아요. 다시 연결해 주세요.");
  }
  return response;
}

/**
 * One upload decision + attempt. `startup` is true when the app was just opened (pending changes and the
 * daily send skip the 10-minute wait). Throws LifeHubError("not_connected") when Life Hub dropped the
 * token by the usual rule; every other failure is an outcome.
 */
export async function runBoardUpload(archive: Archive, deps: RemoteDeps, opts: { startup?: boolean } = {}): Promise<BoardOutcome> {
  const { storage } = deps;
  if (!boardUploadEnabled(storage)) return { kind: "skipped", reason: "off" };
  if (!isConnected(deps)) return { kind: "skipped", reason: "not_connected" };
  if (archive.demo) return { kind: "skipped", reason: "demo" };
  if (!archive.records.length && !archive.wishes.length) return { kind: "skipped", reason: "empty" };
  const now = deps.now();
  const state = readState(storage);
  const manifest = buildBoardTiles(archive, new Date(now));
  const body = JSON.stringify(manifest);
  const sha = hex(await deps.sha256(new TextEncoder().encode(boardBodyForHash(manifest))));
  const dailyDue = !!opts.startup && (state.ok_at === undefined || now - state.ok_at > BOARD_DAILY_MS);
  if (sha === state.sha && !dailyDue) {
    if (state.pending) writeState(storage, { ...state, pending: false });
    return { kind: "skipped", reason: "same" };
  }
  if (sha === state.rejected_sha && !dailyDue) return { kind: "skipped", reason: "rejected" };
  if (sha !== state.sha && !state.pending) { state.pending = true; writeState(storage, state); }
  const wait = state.tried_at === undefined ? 0 : state.tried_at + BOARD_MIN_INTERVAL_MS - now;
  const bypass = !!opts.startup && (state.pending || dailyDue);
  if (wait > 0 && !bypass) return { kind: "throttled", waitMs: wait };

  state.tried_at = now;
  writeState(storage, state);
  let response: Response | "insufficient_scope";
  try { response = await boardPut(deps, body); }
  catch (e) {
    if (e instanceof LifeHubError && e.kind === "network") return { kind: "retry" };
    throw e;
  }
  if (response === "insufficient_scope") {
    writeState(storage, { ...state, reconnect: true });
    return { kind: "reconnect_needed" };
  }
  if (response.status === 200) {
    const reply = await response.json().catch(() => ({})) as { unchanged?: boolean; ignored?: boolean };
    writeState(storage, { sha, ok_at: now, tried_at: now, pending: false });
    return { kind: "sent", result: reply.ignored ? "ignored" : reply.unchanged ? "unchanged" : "stored" };
  }
  if (response.status === 400 || response.status === 413) {
    // A bug on this side (or a clock more than 5 minutes off): do not resend the same content.
    console.error("PALATE board upload rejected by Life Hub:", response.status, await response.text().catch(() => ""));
    writeState(storage, { ...state, rejected_sha: sha, pending: false });
    return { kind: "rejected", status: response.status };
  }
  return { kind: "retry" };
}
