import test from "node:test";
import assert from "node:assert/strict";
import { emptyArchive } from "../src/lib/data.js";
import { addLocalCandidate, rejectLocalCandidate, exampleCandidates, inboxStorageKey } from "../src/lib/lifehub-local.js";
import {
  clearReconnectNeeded, connectedLabel, hubState, markReconnectNeeded, pendingCount, reconnectNeeded, RECONNECT_NEEDED_KEY,
} from "../src/lib/lifehub-status.js";

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}

test("state C is remembered on this device until cleared", () => {
  const storage = new MemoryStorage();
  assert.equal(reconnectNeeded(storage), false);
  markReconnectNeeded(storage);
  assert.equal(storage.getItem(RECONNECT_NEEDED_KEY), "1");
  assert.equal(reconnectNeeded(storage), true);
  clearReconnectNeeded(storage);
  assert.equal(reconnectNeeded(storage), false);
});

test("hub state: connected is B, refused token is C, otherwise A", () => {
  assert.equal(hubState({ connected: false, needsReconnect: false }), "A");
  assert.equal(hubState({ connected: true, needsReconnect: false }), "B");
  assert.equal(hubState({ connected: true, needsReconnect: true }), "B");
  assert.equal(hubState({ connected: false, needsReconnect: true }), "C");
});

test("state B status line: no stored time, so 연결됨 / 동기화 중 / 잠시 뒤 다시 시도", () => {
  assert.equal(connectedLabel({ syncing: false, retry: false }), "연결됨");
  assert.equal(connectedLabel({ syncing: true, retry: true }), "연결됨 · 동기화 중…");
  assert.equal(connectedLabel({ syncing: false, retry: true }), "연결됨 · 잠시 뒤 다시 시도");
});

test("pending count only counts candidates still waiting, and is 0 for an unreadable inbox", () => {
  const storage = new MemoryStorage();
  const archive = emptyArchive();
  assert.equal(pendingCount(archive, storage), 0);
  const [first, second] = exampleCandidates();
  addLocalCandidate(archive, first, storage);
  const added = addLocalCandidate(archive, second, storage);
  assert.equal(pendingCount(archive, storage), 2);
  rejectLocalCandidate(archive, added.key, storage);
  assert.equal(pendingCount(archive, storage), 1);
  storage.setItem(inboxStorageKey(archive.user.id), "not json");
  assert.equal(pendingCount(archive, storage), 0);
});
