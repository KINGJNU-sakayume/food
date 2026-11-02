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
export interface RemoteState {
  /** Hub revision of this candidate (0 = never edited). */
  revision: number;
  status: "pending" | "approved";
  needs_app_review: boolean;
}
/**
 * A candidate pulled from Life Hub (`final_candidate ?? candidate`). Like enqueue, but a pending local copy
 * follows a NEWER hub revision (the owner edited it in a Claude card) and records the hub status. Same
 * revision with different content is still a conflict; confirmed and rejected entries never change.
 */
export function upsertRemoteCandidate(
  previous: CandidateEnvelope[], untrusted: unknown, remote: RemoteState, receivedAt: string,
): EnqueueResult {
  const candidate = validateCandidate(untrusted);
  const key = candidateKey(candidate);
  if (!Number.isSafeInteger(remote.revision) || remote.revision < 0 || !["pending", "approved"].includes(remote.status))
    throw new Error("Life Hub 후보 상태를 확인할 수 없습니다.");
  const state = { hub_revision: remote.revision, hub_status: remote.status, needs_app_review: remote.needs_app_review === true };
  const existing = previous.find(entry => entry.key === key);
  if (!existing) {
    const inserted = enqueueCandidate(previous, candidate, receivedAt);
    return { ...inserted, entries: inserted.entries.map(e => e.key === key ? { ...e, ...state } : e) };
  }
  if (existing.status !== "pending") return { entries: previous, result: "duplicate", key };
  const known = existing.hub_revision ?? 0;
  if (remote.revision < known) return { entries: previous, result: "duplicate", key };
  if (remote.revision === known && !sameCandidate(existing.candidate, candidate))
    throw new Error("같은 Life Hub 요청 키에 서로 다른 내용이 들어왔습니다. 기존 후보를 덮어쓰지 않습니다.");
  const next = { ...existing, ...state, candidate: remote.revision > known ? candidate : existing.candidate };
  if (JSON.stringify(next) === JSON.stringify(existing)) return { entries: previous, result: "duplicate", key };
  return { entries: previous.map(e => e.key === key ? next : e), result: "duplicate", key };
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
