/**
 * What the settings 「Life Hub」 section and the header signals show (layout only; the sync itself is
 * lifehub-autosync / lifehub-remote, unchanged).
 *
 * A: not connected · B: connected · C: needs attention (Life Hub refused the token, so this device
 * must sign in again). C is remembered on this device so the settings dot survives a reload.
 */
import type { Archive } from "../types/model.js";
import { readLocalInbox } from "./lifehub-local.js";

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const RECONNECT_NEEDED_KEY = "palate.lifehub.reconnect-needed.v1";

export function reconnectNeeded(storage: Pick<Storage, "getItem">): boolean {
  try { return storage.getItem(RECONNECT_NEEDED_KEY) === "1"; } catch { return false; }
}
export function markReconnectNeeded(storage: KV): void {
  try { storage.setItem(RECONNECT_NEEDED_KEY, "1"); } catch { /* the in-memory state still shows it */ }
}
export function clearReconnectNeeded(storage: KV): void {
  try { storage.removeItem(RECONNECT_NEEDED_KEY); } catch { /* nothing to clear */ }
}

/** Candidates waiting for the owner in this device's inbox (0 when the inbox cannot be read). */
export function pendingCount(archive: Archive, storage: Pick<Storage, "getItem"> = localStorage): number {
  try { return readLocalInbox(archive, storage).filter((e) => e.status === "pending").length; } catch { return 0; }
}

export type HubState = "A" | "B" | "C";
export function hubState(s: { connected: boolean; needsReconnect: boolean }): HubState {
  if (s.connected) return "B";
  return s.needsReconnect ? "C" : "A";
}
/** State B status line. PALATE does not store when it last fetched proposals, so no time is shown. */
export function connectedLabel(s: { syncing: boolean; retry: boolean }): string {
  if (s.syncing) return "연결됨 · 동기화 중…";
  if (s.retry) return "연결됨 · 잠시 뒤 다시 시도";
  return "연결됨";
}
