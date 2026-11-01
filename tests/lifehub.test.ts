import test from "node:test";
import assert from "node:assert/strict";
import { validateCandidate, candidateKey } from "../src/lib/lifehub-contract.js";
import {
  enqueueCandidate, pendingCandidates, rejectCandidate, markCandidateConfirmed,
} from "../src/lib/lifehub-inbox.js";
import { emptyArchive, saveRecord } from "../src/lib/data.js";

const meal = {
  schema_version: 1,
  candidate_type: "meal",
  source: "chatgpt",
  source_ref: "chat-message-ref-100",
  idempotency_key: "chatgpt_opaque_100",
  created_at: "2026-11-01T05:00:00Z",
  payload: {
    menu_name: "돈코츠 라멘",
    place_name: "멘야하나",
    note: "진하고 맛있었다",
    verdict: "LIKE",
    // eaten_at intentionally omitted: never infer dates for older statements.
  },
};
const wish = {
  schema_version: 1,
  candidate_type: "wish",
  source: "claude",
  source_ref: "claude-source-1",
  idempotency_key: "claude_wish_001",
  created_at: "2026-11-01T05:00:00Z",
  payload: {
    wish_kind: "visit_place",
    name: "가보고 싶은 식당",
    source_url: "https://example.com/restaurant",
  },
};

test("candidate validation accepts a pending meal without inventing a date", () => {
  const result = validateCandidate(meal);
  assert.equal(result.candidate_type, "meal");
  if (result.candidate_type === "meal") {
    assert.equal(result.payload.eaten_at, undefined);
  }
  assert.equal(candidateKey(result), "chatgpt:chatgpt_opaque_100");
});

test("candidate validation refuses unknown status, transcript and unsafe URLs", () => {
  for (const bad of [
    { ...meal, status: "confirmed" },
    { ...meal, raw_chat_transcript: "private message" },
    { ...meal, schema_version: 2 },
    { ...meal, source: "untrusted-plugin" },
    { ...meal, idempotency_key: "too" },
    { ...meal, payload: { ...meal.payload, eaten_at: "2026-02-31" } },
    { ...meal, payload: { ...meal.payload, verdict: "CERTAIN" } },
    { ...meal, payload: { ...meal.payload, unexpected: "smuggle" } },
    { ...wish, payload: { ...wish.payload, source_url: "javascript:alert(1)" } },
  ]) assert.throws(() => validateCandidate(bad));
  assert.equal(validateCandidate(wish).candidate_type, "wish");
});

test("inbox deduplicates stable source keys and refuses conflicting replay", () => {
  const a = enqueueCandidate([], meal, "2026-11-01T05:03:00Z");
  assert.equal(a.result, "inserted");
  assert.equal(a.entries.length, 1);
  assert.equal(a.entries[0].status, "pending");
  const replay = enqueueCandidate(a.entries, {
    ...meal, created_at: "2026-11-01T06:00:00Z", source_ref: "repeated-reference",
  }, "2026-11-01T06:00:00Z");
  assert.equal(replay.result, "duplicate");
  assert.equal(replay.entries, a.entries);
  assert.throws(() => enqueueCandidate(a.entries, {
    ...meal, payload: { ...meal.payload, note: "changed text" },
  }, "2026-11-01T06:00:00Z"), /덮어쓰지/);
  const claude = enqueueCandidate(a.entries, { ...meal, source: "claude" }, "2026-11-01T06:00:00Z");
  assert.equal(claude.entries.length, 2);
});

test("candidate cannot become confirmed without an actual persisted PALATE record", () => {
  const pending = enqueueCandidate([], meal, "2026-11-01T05:03:00Z");
  let archive = emptyArchive();
  assert.equal(archive.records.length, 0);
  assert.throws(() => markCandidateConfirmed(
    pending.entries, pending.key, archive, "fabricated-meal", "2026-11-01T05:04:00Z",
  ), /먼저 실제/);
  archive = saveRecord(archive, {
    menu_name: "돈코츠 라멘",
    brand_name: "",
    place_name: "멘야하나",
    address: "",
    category: "라멘",
    verdict: "LIKE",
    reorder_intent: "MAYBE",
    short_note: "진하고 맛있었다",
    detailed_note: "",
    eaten_at: "2026-11-01",
    dining_context: "DINE_IN",
    tags: [], photos: [],
  });
  const confirmed = markCandidateConfirmed(
    pending.entries, pending.key, archive, archive.records[0].id, "2026-11-01T05:04:00Z",
  );
  assert.equal(confirmed[0].status, "confirmed");
  assert.equal(pendingCandidates(confirmed).length, 0);
  assert.equal(markCandidateConfirmed(
    confirmed, pending.key, archive, archive.records[0].id, "2026-11-01T05:05:00Z",
  ), confirmed);
  assert.throws(() => markCandidateConfirmed(
    confirmed, pending.key, archive, "different-id", "2026-11-01T05:05:00Z",
  ));
});

test("rejection is idempotent and irreversible without a new candidate", () => {
  const first = enqueueCandidate([], wish, "2026-11-01T05:03:00Z");
  const rejected = rejectCandidate(first.entries, first.key, "2026-11-01T05:10:00Z");
  assert.equal(rejected[0].status, "rejected");
  assert.equal(rejectCandidate(rejected, first.key, "2026-11-01T05:20:00Z"), rejected);
  assert.throws(() => markCandidateConfirmed(
    rejected, first.key, emptyArchive(), "wish-1", "2026-11-01T05:20:00Z",
  ));
});
