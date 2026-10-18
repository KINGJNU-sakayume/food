import test from "node:test";
import assert from "node:assert/strict";
import {
  demoArchive,
  emptyArchive,
  isFavourite,
  menuRecords,
  normalize,
  persistArchive,
  preference,
  removePlace,
  removeRecord,
  saveRecord,
  searchable,
  validateArchive,
} from "../src/lib/data.js";
import type { RecordDraft } from "../src/types/model.js";
const draft = (changes: Partial<RecordDraft> = {}): RecordDraft => ({
  menu_name: "싸이버거",
  brand_name: "맘스터치",
  place_name: "연남점",
  address: "서울",
  category: "버거",
  verdict: "LIKE",
  reorder_intent: "NO",
  short_note: "맛은 좋지만 비싸다",
  detailed_note: "",
  eaten_at: "2026-10-18",
  dining_context: "DINE_IN",
  tags: ["혼밥"],
  photos: [],
  ...changes,
});
test("repeated meals share a menu while verdict and reorder stay independent", () => {
  let a = saveRecord(emptyArchive(), draft());
  a = saveRecord(
    a,
    draft({
      menu_name: "싸이 버거",
      verdict: "DISLIKE",
      eaten_at: "2026-10-19",
    }),
  );
  assert.equal(a.menus.length, 1);
  assert.equal(a.records.length, 2);
  assert.equal(a.offerings.length, 1);
  assert.equal(a.records[0].reorder_intent, "NO");
  assert.equal(a.records[0].verdict, "LIKE");
  assert.equal(preference(menuRecords(a, a.menus[0].id)), "DISLIKE");
  assert.deepEqual(
    validateArchive(JSON.parse(JSON.stringify(a))),
    JSON.parse(JSON.stringify(a)),
  );
});
test("brands separate identically named menus and one menu can have multiple places", () => {
  let a = saveRecord(emptyArchive(), draft());
  a = saveRecord(a, draft({ brand_name: "다른 브랜드" }));
  assert.equal(a.menus.length, 2);
  a = saveRecord(a, draft({ place_name: "신촌점" }));
  assert.equal(a.menus.length, 2);
  assert.equal(a.offerings.length, 3);
});
test("record deletion preserves menu, place deletion preserves records and photos", () => {
  let a = saveRecord(
    emptyArchive(),
    draft({
      photos: [
        { storage_path: "data:image/webp;base64,AAAA", width: 1, height: 1 },
      ],
    }),
  );
  const menuId = a.menus[0].id;
  const placeId = a.places[0].id;
  const recordId = a.records[0].id;
  a = removePlace(a, placeId);
  assert.equal(a.records.length, 1);
  assert.equal(a.records[0].place_id, undefined);
  assert.equal(a.photos.length, 1);
  assert.equal(a.offerings.length, 0);
  validateArchive(a);
  a = removeRecord(a, recordId);
  assert.equal(a.menus[0].id, menuId);
  assert.equal(a.photos.length, 0);
  assert.equal(a.record_tags.length, 0);
  validateArchive(a);
});
test("edit updates the same event and replaces its photo/tag links", () => {
  let a = saveRecord(emptyArchive(), draft());
  const r = a.records[0];
  a = saveRecord(
    a,
    draft({
      menu_id: r.menu_id,
      verdict: "NEUTRAL",
      tags: ["여행"],
      short_note: "새 메모",
    }),
    r.id,
  );
  assert.equal(a.records.length, 1);
  assert.equal(a.records[0].id, r.id);
  assert.equal(a.records[0].created_at, r.created_at);
  assert.equal(a.record_tags.length, 1);
  assert.equal(
    a.tags.find((t) => t.id === a.record_tags[0].tag_id)?.name,
    "여행",
  );
  assert.ok(searchable(a, r.menu_id).includes(normalize("새 메모")));
});
test("JSON rejects unknown versions, other owners, orphan links, bad enums and unsafe photos", () => {
  const a = demoArchive();
  for (const mutate of [
    (x: any) => (x.schema_version = 999),
    (x: any) => (x.records[0].user_id = "other"),
    (x: any) => (x.records[0].menu_id = "missing"),
    (x: any) => (x.records[0].verdict = "FIVE_STARS"),
    (x: any) => (x.records[0].eaten_at = "2026-02-31"),
    (x: any) => (x.records[0].price_paid = -1),
    (x: any) => (x.menus[0].category = {}),
    (x: any) => x.records.push(x.records[0]),
    (x: any) =>
      x.photos.push({
        id: "photo",
        user_id: x.user.id,
        created_at: x.user.created_at,
        eating_record_id: x.records[0].id,
        storage_path: "javascript:alert(1)",
        width: 10,
        height: 10,
        sort_order: 0,
      }),
  ]) {
    const copy = structuredClone(a);
    mutate(copy);
    assert.throws(() => validateArchive(copy));
  }
  assert.equal(validateArchive(a).records.length, 10);
});
test("a failed persistence leaves the old storage untouched", () => {
  const old = "previous archive";
  let stored = old;
  const storage = {
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
  };
  assert.throws(() => persistArchive(emptyArchive(), storage), /저장 공간/);
  assert.equal(stored, old);
});
test("favourites derive from actual meals, may be overridden, and include recency", () => {
  let a = emptyArchive();
  for (let i = 1; i <= 3; i++)
    a = saveRecord(a, draft({ eaten_at: `2026-10-0${i}` }));
  const menuId = a.menus[0].id;
  assert.equal(isFavourite(a, menuId), true);
  a = saveRecord(a, draft({ eaten_at: "2026-10-18", verdict: "DISLIKE" }));
  assert.equal(isFavourite(a, menuId), false);
  a.menus[0].favourite_override = true;
  assert.equal(isFavourite(a, menuId), true);
});
