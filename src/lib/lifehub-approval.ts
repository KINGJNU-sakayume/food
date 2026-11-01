/**
 * PALATE-local candidate approval. The receipt and actual entity are appended
 * in the SAME Archive update, which P2-B commits as one IndexedDB transaction.
 * Replays cannot create duplicate meals even if the sidecar inbox write fails.
 */
import type { Archive, RecordDraft } from "../types/model.js";
import { normalize, saveRecord, validateArchive } from "./data.js";
import { savePlace } from "./discovery.js";
import { candidateKey, validateCandidate, type LifeHubCandidate } from "./lifehub-contract.js";

export interface MealReview {
  candidate_type: "meal";
  menu_name: string;
  place_name: string;
  address: string;
  eaten_at: string;
  verdict: RecordDraft["verdict"];
  reorder_intent: RecordDraft["reorder_intent"];
  note: string;
}
export interface WishReview {
  candidate_type: "wish";
  name: string;
  address: string;
  source_url?: string;
}
export type CandidateReview = MealReview | WishReview;
export interface ApprovalResult {
  archive: Archive;
  entity_id: string;
  duplicate: boolean;
}
const validDate = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toISOString().slice(0, 10) === v;
const val = (v: unknown, max: number) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;

export function approveCandidate(
  original: Archive, untrustedCandidate: unknown, review: CandidateReview,
): ApprovalResult {
  const candidate: LifeHubCandidate = validateCandidate(untrustedCandidate);
  const key = candidateKey(candidate);
  const receipt = original.lifehub_receipts?.find(x => x.key === key);
  if (receipt) return { archive: original, entity_id: receipt.entity_id, duplicate: true };
  if (review.candidate_type !== candidate.candidate_type)
    throw new Error("후보 유형과 승인 내용이 다릅니다.");
  let next: Archive;
  let entity_id: string;
  if (review.candidate_type === "meal") {
    if (!val(review.menu_name, 200) || typeof review.place_name !== "string" ||
        review.place_name.length > 200 || typeof review.address !== "string" ||
        review.address.length > 2000 || typeof review.note !== "string" ||
        review.note.length > 1000 || !validDate(review.eaten_at) ||
        !["LIKE", "NEUTRAL", "DISLIKE"].includes(review.verdict) ||
        !["YES", "MAYBE", "NO"].includes(review.reorder_intent))
      throw new Error("식사 메뉴·날짜·평가·재주문 의사를 모두 확인해 주세요.");
    const draft: RecordDraft = {
      menu_name: review.menu_name.trim(),
      brand_name: "",
      place_name: review.place_name.trim(),
      address: review.address.trim(),
      category: "",
      verdict: review.verdict,
      reorder_intent: review.reorder_intent,
      short_note: review.note.trim(),
      detailed_note: "",
      eaten_at: review.eaten_at,
      dining_context: "DINE_IN",
      tags: [],
      photos: [],
    };
    next = saveRecord(original, draft);
    const before = new Set(original.records.map(r => r.id));
    const created = next.records.find(r => !before.has(r.id));
    if (!created) throw new Error("새 식사 기록의 저장 결과를 확인하지 못했습니다.");
    entity_id = created.id;
  } else {
    if (!val(review.name, 200) || typeof review.address !== "string" ||
        review.address.length > 2000 ||
        (review.source_url !== undefined &&
          (!/^https:\/\//.test(review.source_url) || review.source_url.length > 2048)))
      throw new Error("관심 메뉴·가게 이름과 링크를 확인해 주세요.");
    if (candidate.candidate_type !== "wish")
      throw new Error("잘못된 관심 후보입니다.");
    if (candidate.payload.wish_kind === "visit_place") {
      const result = savePlace(original, {
        name: review.name.trim(),
        address: review.address.trim(),
        source_url: review.source_url,
      });
      next = result.archive;
      const existing = next.wishes.find(w => w.target_type === "PLACE" && w.target_id === result.placeId);
      if (existing) entity_id = existing.id;
      else {
        entity_id = crypto.randomUUID();
        next.wishes.push({ id: entity_id, user_id: next.user.id, created_at: new Date().toISOString(), target_type: "PLACE", target_id: result.placeId });
      }
    } else {
      next = structuredClone(original);
      let menu = next.menus.find(m => m.normalized_name === normalize(review.name) && !m.brand_id && !m.place_id);
      if (!menu) {
        menu = { id: crypto.randomUUID(), user_id: next.user.id, created_at: new Date().toISOString(), name: review.name.trim(), normalized_name: normalize(review.name), active: true, discovered: true, source_url: review.source_url };
        next.menus.push(menu);
      }
      const existing = next.wishes.find(w => w.target_type === "MENU" && w.target_id === menu!.id);
      if (existing) entity_id = existing.id;
      else {
        entity_id = crypto.randomUUID();
        next.wishes.push({ id: entity_id, user_id: next.user.id, created_at: new Date().toISOString(), target_type: "MENU", target_id: menu!.id });
      }
    }
  }
  next.lifehub_receipts = [...(next.lifehub_receipts || []), {
    key, entity_type: candidate.candidate_type, entity_id,
    approved_at: new Date().toISOString(),
  }];
  return { archive: validateArchive(next), entity_id, duplicate: false };
}
