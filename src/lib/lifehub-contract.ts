/**
 * Life Hub → PALATE v1 candidate contract.
 *
 * Untrusted text from an assistant is NEVER written directly as an EatingRecord.
 * An authenticated transport must supply the candidate; this module ONLY validates
 * the content and constructs a pending item. It neither authenticates requests
 * nor makes network calls. Never store raw conversation transcripts or tokens.
 */
import type { Reorder, Verdict } from "../types/model.js";

export const LIFEHUB_CONTRACT_VERSION = 1;
export type CandidateSource = "chatgpt" | "claude" | "codex" | "manual";

interface CandidateBase {
  schema_version: 1;
  source: CandidateSource;
  /** Opaque source message reference, never the message body. */
  source_ref: string;
  /** Stable upstream operation key: do not generate this on retries. */
  idempotency_key: string;
  created_at: string;
}
export interface MealCandidate extends CandidateBase {
  candidate_type: "meal";
  payload: {
    menu_name: string;
    place_name?: string;
    eaten_at?: string;
    verdict?: Verdict;
    reorder_intent?: Reorder;
    note?: string;
  };
}
export interface WishCandidate extends CandidateBase {
  candidate_type: "wish";
  payload: {
    wish_kind: "visit_place" | "try_menu";
    name: string;
    source_url?: string;
    note?: string;
  };
}
export type LifeHubCandidate = MealCandidate | WishCandidate;
export type CandidateStatus = "pending" | "confirmed" | "rejected";
export interface CandidateEnvelope {
  key: string;
  candidate: LifeHubCandidate;
  status: CandidateStatus;
  received_at: string;
  reviewed_at?: string;
  /** The actual PALATE entity ID, created ONLY after an explicit confirmed save. */
  confirmed_entity_id?: string;
  /** Life Hub card review: the hub revision this copy reflects (owner edits in a Claude card raise it). */
  hub_revision?: number;
  /** "approved" = the owner approved it in a Claude card; PALATE still has to save it. */
  hub_status?: "pending" | "approved";
  /** Life Hub asks for a last check in PALATE before saving. */
  needs_app_review?: boolean;
}
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const allowed = (v: Record<string, unknown>, fields: string[]) =>
  Object.keys(v).every(k => fields.includes(k));
const required = (v: unknown, max: number) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const optional = (v: unknown, max: number) =>
  v === undefined || required(v, max);
const iso = (v: unknown) =>
  required(v, 40) && typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));
const dateOnly = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const value = new Date(v);
  return !Number.isNaN(value.getTime()) && value.toISOString().slice(0, 10) === v;
};
function fail(): never {
  throw new Error("Life Hub 기록 후보 형식이 올바르지 않습니다. 확정 기록은 생성되지 않았습니다.");
}
function httpsUrl(v: unknown): boolean {
  if (typeof v !== "string" || v.length > 2048) return false;
  try { return new URL(v).protocol === "https:"; } catch { return false; }
}

/**
 * Content contract only. This does NOT verify the source provider's identity.
 * Authentication and cross-account authorization belong to the P3 API.
 */
export function validateCandidate(input: unknown): LifeHubCandidate {
  if (!obj(input) ||
      !allowed(input, ["schema_version", "source", "source_ref", "idempotency_key", "created_at", "candidate_type", "payload"]) ||
      input.schema_version !== 1 ||
      !["chatgpt", "claude", "codex", "manual"].includes(String(input.source)) ||
      !required(input.source_ref, 200) ||
      !/^[A-Za-z0-9_.:-]{1,200}$/.test(String(input.source_ref)) ||
      !required(input.idempotency_key, 128) ||
      !/^[A-Za-z0-9_.:-]{8,128}$/.test(String(input.idempotency_key)) ||
      !iso(input.created_at) ||
      !obj(input.payload))
    return fail();

  const p = input.payload;
  if (input.candidate_type === "meal") {
    if (!allowed(p, ["menu_name", "place_name", "eaten_at", "verdict", "reorder_intent", "note"]) ||
        !required(p.menu_name, 200) ||
        !optional(p.place_name, 200) ||
        (p.eaten_at !== undefined && !dateOnly(p.eaten_at)) ||
        (p.verdict !== undefined && !["LIKE", "NEUTRAL", "DISLIKE"].includes(String(p.verdict))) ||
        (p.reorder_intent !== undefined && !["YES", "MAYBE", "NO"].includes(String(p.reorder_intent))) ||
        !optional(p.note, 1000))
      return fail();
  } else if (input.candidate_type === "wish") {
    if (!allowed(p, ["wish_kind", "name", "source_url", "note"]) ||
        !["visit_place", "try_menu"].includes(String(p.wish_kind)) ||
        !required(p.name, 200) ||
        (p.source_url !== undefined && !httpsUrl(p.source_url)) ||
        !optional(p.note, 1000))
      return fail();
  } else return fail();

  // JSON copy strips prototypes and prevents an upstream caller from mutating
  // a queued record after validation.
  return JSON.parse(JSON.stringify(input)) as LifeHubCandidate;
}

export function candidateKey(candidate: LifeHubCandidate): string {
  return candidate.source + ":" + candidate.idempotency_key;
}

export function sameCandidate(a: LifeHubCandidate, b: LifeHubCandidate): boolean {
  // Arrival timestamps and provider-generated opaque references do not change
  // the meaning of an idempotent *same operation*. Payload changes are conflicts.
  return a.source === b.source &&
    a.idempotency_key === b.idempotency_key &&
    a.candidate_type === b.candidate_type &&
    JSON.stringify(a.payload) === JSON.stringify(b.payload);
}
