/**
 * Local-only inbox for exercising the P3 contract before any Life Hub exists.
 * Entries are small text payloads, never photos/credentials. The independent
 * Archive receipt is the source of truth for approvals.
 */
import type { Archive } from "../types/model.js";
import { candidateKey, type CandidateEnvelope } from "./lifehub-contract.js";
import { enqueueCandidate, rejectCandidate } from "./lifehub-inbox.js";
import { validateCandidate } from "./lifehub-contract.js";

const PREFIX = "palate.lifehub.local-inbox.v1.";
const MAX_BYTES = 250_000;
export function inboxStorageKey(userId: string) { return PREFIX + userId; }

export function reconcileInbox(archive: Archive, entries: CandidateEnvelope[]): CandidateEnvelope[] {
  const receipts = new Map((archive.lifehub_receipts || []).map(r => [r.key, r]));
  return entries.map(entry => {
    const receipt = receipts.get(entry.key);
    return receipt
      ? { ...entry, status: "confirmed", confirmed_entity_id: receipt.entity_id, reviewed_at: receipt.approved_at }
      : entry;
  });
}
export function readLocalInbox(archive: Archive, storage: Pick<Storage, "getItem"> = localStorage): CandidateEnvelope[] {
  const raw = storage.getItem(inboxStorageKey(archive.user.id));
  if (!raw) return [];
  if (raw.length > MAX_BYTES) throw new Error("후보함 저장 데이터가 너무 큽니다. 기존 후보 데이터를 보존했습니다.");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 500) throw new Error("후보함 형식을 확인할 수 없습니다.");
  const keys = new Set<string>();
  const entries = parsed.map((v): CandidateEnvelope => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("잘못된 기록 후보입니다.");
    const item = v as CandidateEnvelope;
    const candidate = validateCandidate(item.candidate);
    if (typeof item.key !== "string" || item.key !== candidateKey(candidate) || keys.has(item.key) ||
        !["pending","confirmed","rejected"].includes(item.status) ||
        typeof item.received_at !== "string" || Number.isNaN(Date.parse(item.received_at)) ||
        (item.reviewed_at !== undefined && (typeof item.reviewed_at !== "string" || Number.isNaN(Date.parse(item.reviewed_at)))))
      throw new Error("후보함에 손상된 기록이 있습니다. 자동 초기화하지 않습니다.");
    keys.add(item.key);
    return { key:item.key, candidate, status:item.status, received_at:item.received_at,
      reviewed_at:item.reviewed_at, confirmed_entity_id:item.confirmed_entity_id };
  });
  return reconcileInbox(archive, entries);
}
function write(archive: Archive, entries: CandidateEnvelope[], storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {
  const key = inboxStorageKey(archive.user.id);
  const serialized = JSON.stringify(entries);
  if (serialized.length > MAX_BYTES) throw new Error("후보함이 가득 찼습니다. 기존 내용은 보존됩니다.");
  storage.setItem(key, serialized);
}
export function addLocalCandidate(archive: Archive, input: unknown, storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {
  const before = readLocalInbox(archive, storage);
  const outcome = enqueueCandidate(before, input, new Date().toISOString());
  if (outcome.result === "inserted") write(archive, outcome.entries, storage);
  return { ...outcome, entries: reconcileInbox(archive, outcome.entries) };
}
export function rejectLocalCandidate(archive: Archive, key: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {
  const before = readLocalInbox(archive, storage);
  const next = rejectCandidate(before, key, new Date().toISOString());
  if (next !== before) write(archive, next, storage);
  return next;
}
export function completeLocalCandidate(archive: Archive, key: string, entityId: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {
  const receipt = archive.lifehub_receipts?.find(r => r.key === key && r.entity_id === entityId);
  if (!receipt) throw new Error("아카이브의 승인 기록을 찾을 수 없습니다.");
  const before = readLocalInbox(archive, storage);
  const next = before.map(e => e.key === key ?
    { ...e, status: "confirmed" as const, reviewed_at: receipt.approved_at, confirmed_entity_id: entityId } : e);
  write(archive, next, storage);
  return next;
}

/** Clearly labeled manual examples; they are never represented as real meals. */
export function exampleCandidates(now = new Date()): unknown[] {
  const base = { schema_version: 1, source:"manual", created_at:now.toISOString() };
  return [
    { ...base, candidate_type:"meal", source_ref:"sample-meal-0001",
      idempotency_key:"palate_sample_meal_0001",
      payload:{ menu_name:"돈코츠 라멘", place_name:"예시 라멘집", verdict:"LIKE", note:"면과 육수가 좋았다는 예시 메모" } },
    { ...base, candidate_type:"wish", source_ref:"sample-wish-0002",
      idempotency_key:"palate_sample_wish_0002",
      payload:{ wish_kind:"visit_place", name:"가보고 싶은 예시 식당", note:"후보함 시연용 데이터" } },
  ];
}
