/**
 * Side-effect-free Life Hub inbox reducer. The sync transport (P3) may call
 * enqueue only after authenticating the owner; this module NEVER writes food
 * records and NEVER upgrades a candidate to a meal by itself.
 */
import type { Archive } from "../types/model.js";
import {
  candidateKey, sameCandidate, validateCandidate,
  type CandidateEnvelope, type LifeHubCandidate,
} from "./lifehub-contract.js";

export interface EnqueueResult {
  entries: CandidateEnvelope[];
  result: "inserted" | "duplicate";
  key: string;
}
export function enqueueCandidate(
  previous: CandidateEnvelope[], untrusted: unknown, receivedAt: string,
): EnqueueResult {
  const candidate = validateCandidate(untrusted);
  const key = candidateKey(candidate);
  const existing = previous.find(entry => entry.key === key);
  if (existing) {
    if (!sameCandidate(existing.candidate, candidate))
      throw new Error("같은 Life Hub 요청 키에 서로 다른 내용이 들어왔습니다. 기존 후보를 덮어쓰지 않습니다.");
    return { entries: previous, result: "duplicate", key };
  }
  const received = new Date(receivedAt);
  if (!Number.isFinite(received.getTime()))
    throw new Error("후보 수신 시각을 확인할 수 없습니다.");
  return {
    entries: [...previous, {
      key, candidate, status: "pending", received_at: received.toISOString(),
    }],
    result: "inserted", key,
  };
}
export function rejectCandidate(
  previous: CandidateEnvelope[], key: string, reviewedAt: string,
): CandidateEnvelope[] {
  const found = previous.find(entry => entry.key === key);
  if (!found) throw new Error("거절할 후보를 찾지 못했습니다.");
  if (found.status === "confirmed")
    throw new Error("이미 기록으로 확정한 후보를 단순 거절할 수 없습니다.");
  if (found.status === "rejected") return previous;
  const time = new Date(reviewedAt);
  if (!Number.isFinite(time.getTime())) throw new Error("검토 시각이 올바르지 않습니다.");
  return previous.map(entry => entry.key === key
    ? { ...entry, status: "rejected", reviewed_at: time.toISOString() }
    : entry);
}
/**
 * ONLY after a separate, successful PALATE repository transaction has saved
 * the actual meal/wish. Never called when the request itself first arrives.
 */
export function markCandidateConfirmed(
  previous: CandidateEnvelope[], key: string, archive: Archive,
  entityId: string, reviewedAt: string,
): CandidateEnvelope[] {
  const found = previous.find(entry => entry.key === key);
  if (!found) throw new Error("확정할 후보를 찾지 못했습니다.");
  if (found.status === "rejected") throw new Error("거절된 후보는 바로 확정할 수 없습니다.");
  if (found.status === "confirmed") {
    if (found.confirmed_entity_id === entityId) return previous;
    throw new Error("이미 다른 기록으로 연결된 후보입니다.");
  }
  if (found.candidate.candidate_type === "meal") {
    if (!archive.records.some(record => record.id === entityId))
      throw new Error("먼저 실제 식사 기록을 저장해야 확인 완료할 수 있습니다.");
  } else if (!archive.wishes.some(w => w.id === entityId)) {
    throw new Error("먼저 실제 관심 메뉴·장소를 저장해야 확인 완료할 수 있습니다.");
  }
  const time = new Date(reviewedAt);
  if (!Number.isFinite(time.getTime())) throw new Error("검토 시각이 올바르지 않습니다.");
  return previous.map(entry => entry.key === key
    ? { ...entry, status: "confirmed", reviewed_at: time.toISOString(), confirmed_entity_id: entityId }
    : entry);
}
export function pendingCandidates(entries: CandidateEnvelope[]) {
  return entries.filter(entry => entry.status === "pending");
}
export type { LifeHubCandidate, CandidateEnvelope };
