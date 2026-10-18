import test from "node:test";
import assert from "node:assert/strict";
import {
  demoArchive,
  emptyArchive,
  removePlace,
  removeRecord,
  saveRecord,
  validateArchive,
} from "../src/lib/data.js";
import {
  addCatalog,
  addMenuToVenue,
  applyRestaurantDetails,
  isWanted,
  savePlace,
  saveSharedLink,
  toggleWish,
  updateSavedLink,
  venueMenus,
} from "../src/lib/discovery.js";
import { sharedUrl } from "../src/lib/urls.js";
import type { RecordDraft } from "../src/types/model.js";
const catalog = {
  key: "test-burger",
  name: "테스트버거",
  category: "버거",
  source_url: "https://example.com/menu",
  menus: ["기본 버거", "새우 버거"],
};
const draft = (
  menuId: string,
  overrides: Partial<RecordDraft> = {},
): RecordDraft => ({
  menu_id: menuId,
  menu_name: "기본 버거",
  brand_name: "테스트버거",
  place_name: "",
  address: "",
  category: "버거",
  verdict: "LIKE",
  reorder_intent: "NO",
  short_note: "",
  detailed_note: "",
  eaten_at: "2026-10-18",
  dining_context: "DINE_IN",
  tags: [],
  photos: [],
  ...overrides,
});
test("v1 backup is migrated without changing the original object, IDs or meals", () => {
  const old: any = demoArchive();
  old.schema_version = 1;
  delete old.wishes;
  delete old.saved_links;
  delete old.preferences;
  const original = JSON.stringify(old);
  const restored = validateArchive(old);
  assert.equal(restored.schema_version, 2);
  assert.deepEqual(restored.records, old.records);
  assert.deepEqual(restored.wishes, []);
  assert.deepEqual(restored.saved_links, []);
  assert.equal(JSON.stringify(old), original);
});
test("catalog menus are uneaten and repeated imports preserve existing IDs and wishes", () => {
  const first = addCatalog(emptyArchive(), catalog);
  let a = toggleWish(first.archive, "MENU", first.archive.menus[0].id);
  const second = addCatalog(a, {
    ...catalog,
    menus: [...catalog.menus, "새 메뉴"],
  });
  assert.equal(second.brandId, first.brandId);
  assert.equal(second.archive.records.length, 0);
  assert.equal(second.archive.menus.length, 3);
  assert.equal(second.archive.menus[0].id, first.archive.menus[0].id);
  assert.equal(second.archive.menus[0].discovered, true);
  assert.ok(isWanted(second.archive, "MENU", first.archive.menus[0].id));
  validateArchive(second.archive);
});
test("eating consumes only the menu intention and editing history cannot consume a later wish", () => {
  const saved = addCatalog(emptyArchive(), catalog);
  const mid = saved.archive.menus[0].id;
  let a = toggleWish(saved.archive, "BRAND", saved.brandId);
  a = toggleWish(a, "MENU", mid);
  a = saveRecord(a, draft(mid));
  assert.equal(isWanted(a, "MENU", mid), false);
  assert.equal(isWanted(a, "BRAND", saved.brandId), true);
  assert.equal(a.records[0].verdict, "LIKE");
  assert.equal(a.records[0].reorder_intent, "NO");
  assert.equal(a.menus[0].discovered, false);
  a = toggleWish(a, "MENU", mid);
  a = saveRecord(a, draft(mid, { verdict: "DISLIKE" }), a.records[0].id);
  assert.equal(isWanted(a, "MENU", mid), true);
  a = removeRecord(a, a.records[0].id);
  assert.equal(a.menus.length, 2);
  assert.equal(isWanted(a, "MENU", mid), true);
});
test("identical independent menu names belong to their own restaurants", () => {
  let saved = savePlace(emptyArchive(), { name: "갑 식당", address: "서울 A" });
  const first = saved.placeId;
  let second = savePlace(saved.archive, { name: "을 식당", address: "서울 B" });
  let one = addMenuToVenue(
    second.archive,
    { type: "PLACE", id: first },
    "로스카츠",
  );
  let two = addMenuToVenue(
    one.archive,
    { type: "PLACE", id: second.placeId },
    "로스카츠",
  );
  assert.notEqual(one.menuId, two.menuId);
  assert.equal(venueMenus(two.archive, { type: "PLACE", id: first }).length, 1);
  let a = saveRecord(
    two.archive,
    draft(two.menuId, {
      menu_name: "로스카츠",
      brand_name: "",
      place_id: second.placeId,
      place_name: "을 식당",
    }),
  );
  assert.equal(a.records[0].place_id, second.placeId);
  assert.equal(a.menus.length, 2);
  validateArchive(a);
});
test("link normalization removes Instagram tracking, duplicates preserve organisation", () => {
  let a = emptyArchive();
  const first = saveSharedLink(
    a,
    "여기 가자 https://www.instagram.com/reel/ABC123/?igsh=aaa",
    "눈여겨본 곳",
  );
  a = updateSavedLink(
    first.archive,
    first.linkId,
    "수정한 제목",
    "다음에 방문",
    [],
  );
  const duplicate = saveSharedLink(
    a,
    "https://www.instagram.com/reel/ABC123/?utm_source=copy",
    "다른 제목",
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.archive.saved_links.length, 1);
  assert.equal(duplicate.archive.saved_links[0].title, "수정한 제목");
  assert.equal(duplicate.archive.saved_links[0].note, "다음에 방문");
  assert.equal(
    sharedUrl("https://naver.me/CaSe?utm_source=copy"),
    "https://naver.me/CaSe",
  );
  assert.throws(() => sharedUrl("javascript:alert(1)"));
  assert.throws(() => sharedUrl("https://user:password@example.com"));
  assert.throws(() => sharedUrl("https://www.instagram.com/"));
  assert.equal(
    sharedUrl("https://instagram.com/reel/ABC123/"),
    "https://www.instagram.com/reel/ABC123/",
  );
  assert.equal(
    sharedUrl("https://www.instagram.com/share/reel/ABC123/?igsh=abc"),
    "https://www.instagram.com/share/reel/ABC123/",
  );
});
test("linked reels can reference many venues; venue deletion preserves reels and meals", () => {
  const saved = addCatalog(emptyArchive(), catalog);
  const place = savePlace(saved.archive, { name: "음식점", address: "서울" });
  const link = saveSharedLink(
    place.archive,
    "https://www.instagram.com/reel/ABC/",
  );
  let a = updateSavedLink(link.archive, link.linkId, "맛집 여러 곳", "", [
    { type: "PLACE", id: place.placeId },
    { type: "BRAND", id: saved.brandId },
    { type: "MENU", id: saved.archive.menus[0].id },
  ]);
  a = toggleWish(a, "PLACE", place.placeId);
  a = removePlace(a, place.placeId);
  assert.equal(a.saved_links.length, 1);
  assert.equal(a.saved_links[0].targets.length, 2);
  assert.equal(a.wishes.length, 0);
  validateArchive(a);
});
test("menu refresh upserts offerings, preserves opinions and ignores unavailable responses", () => {
  const p = savePlace(emptyArchive(), { name: "가게", address: "서울" });
  const details = {
    name: "가게",
    address: "서울",
    source_url: "https://example.com/menu",
    menus: [{ name: "우동", external_id: "m1", price: 9000 }],
    menu_status: "available" as const,
    checked_at: "2026-10-18T00:00:00Z",
  };
  let a = applyRestaurantDetails(p.archive, p.placeId, details);
  const mid = a.menus[0].id;
  a = toggleWish(a, "MENU", mid);
  a = applyRestaurantDetails(a, p.placeId, {
    ...details,
    menus: [
      { name: "우동", external_id: "m1", price: 9500 },
      { name: "소바", external_id: "m2" },
    ],
  });
  assert.equal(a.menus.length, 2);
  assert.equal(a.menus[0].id, mid);
  assert.ok(isWanted(a, "MENU", mid));
  assert.equal(a.offerings[0].price, 9500);
  assert.deepEqual(
    applyRestaurantDetails(a, p.placeId, {
      ...details,
      menus: [],
      menu_status: "unavailable",
    }),
    a,
  );
  validateArchive(a);
});
test("v2 validation rejects foreign intentions, orphan link targets and executable URLs", () => {
  const b = addCatalog(emptyArchive(), catalog);
  const a = saveSharedLink(
    toggleWish(b.archive, "MENU", b.archive.menus[0].id),
    "https://www.instagram.com/reel/AB/",
  ).archive;
  for (const change of [
    (x: any) => (x.wishes[0].user_id = "other"),
    (x: any) => (x.wishes[0].target_id = "missing"),
    (x: any) => x.wishes.push({ ...x.wishes[0], id: "duplicate" }),
    (x: any) => (x.saved_links[0].targets = [{ type: "PLACE", id: "missing" }]),
    (x: any) => (x.saved_links[0].url = "javascript:alert(1)"),
    (x: any) => (x.preferences.restaurant_endpoint = "http://example.com"),
    (x: any) => (x.menus[0].source_url = "data:text/html,hello"),
  ]) {
    const copy = structuredClone(a);
    change(copy);
    assert.throws(() => validateArchive(copy));
  }
  assert.deepEqual(
    validateArchive(JSON.parse(JSON.stringify(a))),
    JSON.parse(JSON.stringify(a)),
  );
});
