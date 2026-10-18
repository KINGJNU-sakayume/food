import type {
  Archive,
  EatingRecord,
  RecordDraft,
  Verdict,
} from "../types/model.js";
import { httpsUrl } from "./urls.js";

export const STORAGE_KEY = "palate.archive.v1";
export const verdicts = {
  LIKE: { label: "호", english: "LIKED", mark: "+" },
  NEUTRAL: { label: "보통", english: "NEUTRAL", mark: "=" },
  DISLIKE: { label: "불호", english: "NOT FOR ME", mark: "−" },
};
export const reorders = {
  YES: "다시 먹는다",
  MAYBE: "기회가 되면",
  NO: "다시 안 먹는다",
};
export const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
export const id = () => crypto.randomUUID();
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function emptyArchive(): Archive {
  return {
    schema_version: 2,
    user: {
      id: id(),
      display_name: "나의 아카이브",
      created_at: new Date().toISOString(),
    },
    brands: [],
    places: [],
    menus: [],
    offerings: [],
    records: [],
    photos: [],
    tags: [],
    record_tags: [],
    wishes: [],
    saved_links: [],
    preferences: {},
    demo: false,
  };
}
export const menuRecords = (a: Archive, menuId: string) =>
  a.records
    .filter((r) => r.menu_id === menuId)
    .sort(
      (a, b) =>
        b.eaten_at.localeCompare(a.eaten_at) ||
        b.created_at.localeCompare(a.created_at),
    );
export function preference(records: EatingRecord[]): Verdict | undefined {
  if (!records.length) return;
  const counts = { LIKE: 0, NEUTRAL: 0, DISLIKE: 0 };
  records.forEach((r) => counts[r.verdict]++);
  const maximum = Math.max(...Object.values(counts));
  return records.find((r) => counts[r.verdict] === maximum)?.verdict;
}
export const isFavourite = (a: Archive, menuId: string) => {
  const m = a.menus.find((m) => m.id === menuId);
  const rs = menuRecords(a, menuId);
  return (
    m?.favourite_override ??
    (rs.length >= 3 &&
      rs.filter((r) => r.verdict === "LIKE").length / rs.length >= 0.8 &&
      rs[0].verdict === "LIKE")
  );
};
export function removeRecord(a: Archive, recordId: string): Archive {
  return {
    ...a,
    records: a.records.filter((r) => r.id !== recordId),
    photos: a.photos.filter((p) => p.eating_record_id !== recordId),
    record_tags: a.record_tags.filter((t) => t.eating_record_id !== recordId),
  };
}
export function removePlace(a: Archive, placeId: string): Archive {
  return {
    ...a,
    places: a.places.filter((p) => p.id !== placeId),
    offerings: a.offerings.filter((o) => o.place_id !== placeId),
    records: a.records.map((r) =>
      r.place_id === placeId ? { ...r, place_id: undefined } : r,
    ),
    menus: a.menus.map((m) =>
      m.place_id === placeId ? { ...m, place_id: undefined } : m,
    ),
    wishes: a.wishes.filter(
      (w) => !(w.target_type === "PLACE" && w.target_id === placeId),
    ),
    saved_links: a.saved_links.map((l) => ({
      ...l,
      targets: l.targets.filter(
        (t) => !(t.type === "PLACE" && t.id === placeId),
      ),
    })),
  };
}
export function updateMenuInfo(
  a: Archive,
  menuId: string,
  name: string,
  category: string,
  brandName: string,
): Archive {
  if (!name.trim()) throw new Error("메뉴 이름을 입력해 주세요.");
  const next = structuredClone(a);
  let brand = next.brands.find(
    (b) => normalize(b.name) === normalize(brandName),
  );
  if (brandName.trim() && !brand) {
    brand = {
      id: id(),
      user_id: a.user.id,
      created_at: new Date().toISOString(),
      name: brandName.trim(),
      normalized_name: normalize(brandName),
    };
    next.brands.push(brand);
  }
  next.menus = next.menus.map((m) =>
    m.id === menuId
      ? {
          ...m,
          name: name.trim(),
          normalized_name: normalize(name),
          category: category.trim(),
          brand_id: brand?.id,
        }
      : m,
  );
  return next;
}
export function saveRecord(
  archive: Archive,
  draft: RecordDraft,
  recordId?: string,
): Archive {
  const a = structuredClone(archive),
    now = new Date().toISOString(),
    owned = () => ({ id: id(), user_id: a.user.id, created_at: now });
  if (!draft.menu_name.trim()) throw new Error("메뉴 이름을 입력해 주세요.");
  if (!validDate(draft.eaten_at)) throw new Error("식사 날짜를 확인해 주세요.");
  if (
    draft.price_paid !== undefined &&
    (!Number.isFinite(draft.price_paid) || draft.price_paid < 0)
  )
    throw new Error("가격은 0 이상의 숫자로 입력해 주세요.");
  let brand = a.brands.find(
    (b) => normalize(b.name) === normalize(draft.brand_name),
  );
  if (draft.brand_name.trim() && !brand) {
    brand = {
      ...owned(),
      name: draft.brand_name.trim(),
      normalized_name: normalize(draft.brand_name),
    };
    a.brands.push(brand);
  }
  let place = draft.place_id
    ? a.places.find((p) => p.id === draft.place_id)
    : a.places.find(
        (p) =>
          p.normalized_name === normalize(draft.place_name) &&
          p.brand_id === brand?.id,
      );
  if (draft.place_name.trim() && !place) {
    place = {
      ...owned(),
      name: draft.place_name.trim(),
      normalized_name: normalize(draft.place_name),
      brand_id: brand?.id,
      address: draft.address.trim(),
      place_type: "RESTAURANT",
    };
    a.places.push(place);
  }
  let menu = draft.menu_id
    ? a.menus.find((m) => m.id === draft.menu_id)
    : !draft.force_new_menu
      ? a.menus.find(
          (m) =>
            m.normalized_name === normalize(draft.menu_name) &&
            m.brand_id === brand?.id &&
            (brand
              ? true
              : m.place_id === place?.id ||
                (!m.place_id &&
                  !a.offerings.some(
                    (o) => o.menu_id === m.id && o.place_id !== place?.id,
                  ))),
        )
      : undefined;
  if (!menu) {
    menu = {
      ...owned(),
      name: draft.menu_name.trim(),
      normalized_name: normalize(draft.menu_name),
      brand_id: brand?.id,
      category: draft.category.trim(),
      active: true,
      place_id: brand ? undefined : place?.id,
    };
    a.menus.push(menu);
  }
  menu.discovered = false;
  if (
    place &&
    !a.offerings.some((o) => o.menu_id === menu.id && o.place_id === place.id)
  )
    a.offerings.push({
      ...owned(),
      menu_id: menu.id,
      place_id: place.id,
      price: draft.price_paid,
      currency: "KRW",
      available: true,
    });
  const previous = recordId
    ? a.records.find((r) => r.id === recordId)
    : undefined;
  if (recordId && !previous) throw new Error("수정할 기록을 찾을 수 없습니다.");
  const record: EatingRecord = {
    ...owned(),
    id: recordId ?? id(),
    created_at: previous?.created_at ?? now,
    menu_id: menu.id,
    place_id: place?.id,
    eaten_at: draft.eaten_at,
    verdict: draft.verdict,
    reorder_intent: draft.reorder_intent,
    short_note: draft.short_note.trim(),
    detailed_note: draft.detailed_note.trim(),
    price_paid: draft.price_paid,
    dining_context: draft.dining_context,
    updated_at: now,
  };
  a.records = a.records.filter((r) => r.id !== record.id).concat(record);
  // Editing an old event must not consume a newly added intention.
  if (!recordId)
    a.wishes = a.wishes.filter(
      (w) => !(w.target_type === "MENU" && w.target_id === menu.id),
    );
  a.photos = a.photos
    .filter((p) => p.eating_record_id !== record.id)
    .concat(
      draft.photos.map((p, i) => ({
        ...owned(),
        ...p,
        eating_record_id: record.id,
        sort_order: i,
      })),
    );
  a.record_tags = a.record_tags.filter((t) => t.eating_record_id !== record.id);
  for (const name of [
    ...new Set(draft.tags.map((t) => t.trim()).filter(Boolean)),
  ]) {
    let tag = a.tags.find((t) => normalize(t.name) === normalize(name));
    if (!tag) {
      tag = { ...owned(), name };
      a.tags.push(tag);
    }
    a.record_tags.push({
      user_id: a.user.id,
      eating_record_id: record.id,
      tag_id: tag.id,
    });
  }
  return a;
}

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 20000): v is string =>
  typeof v === "string" && v.length <= max;
const validDate = (v: unknown): v is string =>
  str(v, 10) &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const timestamp = (v: unknown) => str(v, 40) && !Number.isNaN(Date.parse(v));
const optionalString = (v: unknown, max = 2000) =>
  v === undefined || str(v, max);
export function validateArchive(input: unknown): Archive {
  const fail = (): never => {
    throw new Error(
      "PALATE 백업 형식 또는 데이터 연결이 올바르지 않습니다. 기존 기록은 그대로 유지됩니다.",
    );
  };
  if (
    !object(input) ||
    ![1, 2].includes(input.schema_version as number) ||
    !object(input.user) ||
    !str(input.user.id, 100) ||
    !str(input.user.display_name, 100) ||
    !timestamp(input.user.created_at) ||
    typeof input.demo !== "boolean"
  )
    return fail();
  // Read v1 without mutating or overwriting the original storage value.
  if (input.schema_version === 1)
    input = {
      ...input,
      schema_version: 2,
      wishes: [],
      saved_links: [],
      preferences: {},
    };
  const keys = [
    "brands",
    "places",
    "menus",
    "offerings",
    "records",
    "photos",
    "tags",
    "record_tags",
    "wishes",
    "saved_links",
  ] as const;
  for (const k of keys) {
    const rows = (input as Record<string, unknown>)[k];
    if (!Array.isArray(rows) || rows.length > 100000) return fail();
  }
  const a = input as unknown as Archive,
    uid = a.user.id;
  for (const key of keys) {
    const seen = new Set();
    for (const item of a[key]) {
      if (!object(item) || item.user_id !== uid) return fail();
      if (key !== "record_tags") {
        if (
          !str(item.id, 100) ||
          !item.id ||
          seen.has(item.id) ||
          !timestamp(item.created_at)
        )
          return fail();
        seen.add(item.id);
      }
    }
  }
  const brands = new Set(a.brands.map((x) => x.id)),
    menus = new Set(a.menus.map((x) => x.id)),
    places = new Set(a.places.map((x) => x.id)),
    records = new Set(a.records.map((x) => x.id)),
    tags = new Set(a.tags.map((x) => x.id));
  for (const x of [...a.brands, ...a.menus, ...a.places])
    if (
      !str(x.name, 200) ||
      !x.name.trim() ||
      !str(x.normalized_name, 200) ||
      x.normalized_name !== normalize(x.name)
    )
      return fail();
  for (const x of [...a.menus, ...a.places])
    if (x.brand_id !== undefined && !brands.has(x.brand_id)) return fail();
  for (const x of a.menus)
    if (
      typeof x.active !== "boolean" ||
      !optionalString(x.category, 100) ||
      !optionalString(x.description) ||
      (x.favourite_override !== undefined &&
        typeof x.favourite_override !== "boolean") ||
      (x.discovered !== undefined && typeof x.discovered !== "boolean") ||
      (x.place_id !== undefined && !places.has(x.place_id)) ||
      !optionalString(x.external_menu_id, 300) ||
      (x.source_url !== undefined && !httpsUrl(x.source_url))
    )
      return fail();
  for (const x of a.places)
    if (
      ![
        "RESTAURANT",
        "CAFE",
        "BAKERY",
        "BAR",
        "CONVENIENCE",
        "DELIVERY_ONLY",
        "OTHER",
      ].includes(x.place_type) ||
      !optionalString(x.address) ||
      !optionalString(x.external_provider, 100) ||
      !optionalString(x.external_place_id, 200) ||
      (x.source_url !== undefined && !httpsUrl(x.source_url)) ||
      (x.menus_checked_at !== undefined && !timestamp(x.menus_checked_at))
    )
      return fail();
  for (const x of a.offerings)
    if (
      !menus.has(x.menu_id) ||
      !places.has(x.place_id) ||
      !str(x.currency, 10) ||
      typeof x.available !== "boolean" ||
      (x.price !== undefined && (!Number.isFinite(x.price) || x.price < 0))
    )
      return fail();
  for (const x of a.records)
    if (
      !menus.has(x.menu_id) ||
      (x.place_id !== undefined && !places.has(x.place_id)) ||
      !validDate(x.eaten_at) ||
      !["LIKE", "NEUTRAL", "DISLIKE"].includes(x.verdict) ||
      !["YES", "MAYBE", "NO"].includes(x.reorder_intent) ||
      !str(x.short_note, 1000) ||
      !optionalString(x.detailed_note) ||
      !timestamp(x.updated_at) ||
      (x.price_paid !== undefined &&
        (!Number.isFinite(x.price_paid) || x.price_paid < 0)) ||
      (x.dining_context !== undefined &&
        !["DINE_IN", "TAKEOUT", "DELIVERY", "HOME", "OTHER"].includes(
          x.dining_context,
        ))
    )
      return fail();
  for (const x of a.photos)
    if (
      !records.has(x.eating_record_id) ||
      !str(x.storage_path, 4000000) ||
      !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(
        x.storage_path,
      ) ||
      !Number.isInteger(x.width) ||
      x.width <= 0 ||
      x.width > 1600 ||
      !Number.isInteger(x.height) ||
      x.height <= 0 ||
      x.height > 1600 ||
      !Number.isInteger(x.sort_order) ||
      x.sort_order < 0
    )
      return fail();
  for (const x of a.tags)
    if (!str(x.name, 100) || !x.name.trim()) return fail();
  const joins = new Set();
  for (const x of a.record_tags) {
    const key = `${x.eating_record_id}:${x.tag_id}`;
    if (
      !records.has(x.eating_record_id) ||
      !tags.has(x.tag_id) ||
      joins.has(key)
    )
      return fail();
    joins.add(key);
  }
  for (const x of a.brands)
    if (
      !optionalString(x.catalog_key, 100) ||
      (x.source_url !== undefined && !httpsUrl(x.source_url))
    )
      return fail();
  const targetExists = (type: unknown, targetId: unknown) =>
    str(targetId, 100) &&
    (type === "MENU"
      ? menus.has(targetId)
      : type === "PLACE"
        ? places.has(targetId)
        : type === "BRAND"
          ? brands.has(targetId)
          : false);
  const wishKeys = new Set();
  for (const x of a.wishes) {
    const key = x.target_type + ":" + x.target_id;
    if (!targetExists(x.target_type, x.target_id) || wishKeys.has(key))
      return fail();
    wishKeys.add(key);
  }
  const linkUrls = new Set();
  for (const x of a.saved_links) {
    if (
      !httpsUrl(x.url) ||
      !["REEL", "PLACE"].includes(x.kind) ||
      !str(x.title, 200) ||
      !str(x.note, 2000) ||
      !timestamp(x.updated_at) ||
      !Array.isArray(x.targets) ||
      x.targets.length > 200 ||
      linkUrls.has(x.url)
    )
      return fail();
    linkUrls.add(x.url);
    const seen = new Set();
    for (const t of x.targets) {
      if (
        !object(t) ||
        !targetExists(t.type, t.id) ||
        seen.has(t.type + ":" + t.id)
      )
        return fail();
      seen.add(t.type + ":" + t.id);
    }
  }
  if (
    !object(a.preferences) ||
    (a.preferences.restaurant_endpoint !== undefined &&
      !httpsUrl(a.preferences.restaurant_endpoint))
  )
    return fail();
  return structuredClone(a);
}
export function persistArchive(
  a: Archive,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  const data = JSON.stringify(a);
  try {
    storage.setItem(STORAGE_KEY, data);
  } catch {
    throw new Error(
      "저장 공간이 부족하거나 브라우저가 저장을 차단했습니다. 사진 수를 줄이거나 JSON 백업 후 공간을 확보해 주세요. 변경 내용은 저장되지 않았습니다.",
    );
  }
}
export function searchable(a: Archive, menuId: string) {
  const m = a.menus.find((m) => m.id === menuId);
  const rs = menuRecords(a, menuId),
    recordIds = new Set(rs.map((r) => r.id));
  return normalize(
    [
      m?.name,
      m?.category,
      a.brands.find((b) => b.id === m?.brand_id)?.name,
      ...rs.flatMap((r) => [
        r.short_note,
        r.detailed_note,
        a.places.find((p) => p.id === r.place_id)?.name,
      ]),
      ...a.record_tags
        .filter((t) => recordIds.has(t.eating_record_id))
        .map((t) => a.tags.find((x) => x.id === t.tag_id)?.name),
    ].join(" "),
  );
}
export function demoArchive(): Archive {
  let a = emptyArchive();
  a.user.display_name = "취향을 모으는 사람";
  a.demo = true;
  const examples: [string, string, string, string, Verdict, string, string][] =
    [
      [
        "싸이버거",
        "맘스터치",
        "맘스터치 연남점",
        "버거",
        "LIKE",
        "바삭한 첫 입. 결국 다시 찾게 되는 맛.",
        "혼밥",
      ],
      [
        "로스카츠",
        "",
        "정돈 연남",
        "돈카츠",
        "LIKE",
        "얇은 튀김옷과 촉촉한 단면. 소금만으로 충분했다.",
        "점심",
      ],
      [
        "플랫 화이트",
        "",
        "프릳츠 원서",
        "커피",
        "LIKE",
        "오후 세 시, 고소한 우유와 짧은 휴식.",
        "커피",
      ],
      [
        "마르게리타",
        "",
        "부자피자 한강진",
        "피자",
        "LIKE",
        "가장자리까지 남기고 싶지 않은 도우.",
        "주말",
      ],
      [
        "아이스 아메리카노",
        "스타벅스",
        "스타벅스 연남",
        "커피",
        "NEUTRAL",
        "익숙해서 편한 맛. 오늘은 조금 연하게 느껴졌다.",
        "커피",
      ],
      [
        "말차 크림 도넛",
        "",
        "노티드 안국",
        "디저트",
        "DISLIKE",
        "말차보다 크림의 단맛이 먼저 온다.",
        "디저트",
      ],
      [
        "비빔냉면",
        "",
        "을밀대 마포",
        "한식",
        "LIKE",
        "매콤한 양념 뒤로 남는 메밀의 향.",
        "점심",
      ],
    ];
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  examples.forEach((e, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() - i * 2);
    a = saveRecord(a, {
      menu_name: e[0],
      brand_name: e[1],
      place_name: e[2],
      address: "서울",
      category: e[3],
      verdict: e[4],
      reorder_intent:
        e[4] === "DISLIKE" ? "NO" : e[4] === "NEUTRAL" ? "MAYBE" : "YES",
      short_note: e[5],
      detailed_note: "",
      eaten_at: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      dining_context: "DINE_IN",
      tags: [e[6]],
      photos: [],
    });
  });
  for (let i = 1; i <= 3; i++) {
    const r = a.records[0],
      d = new Date(base);
    d.setDate(d.getDate() - i * 12);
    a = saveRecord(a, {
      menu_id: r.menu_id,
      menu_name: "싸이버거",
      brand_name: "맘스터치",
      place_name: "맘스터치 연남점",
      address: "",
      category: "버거",
      verdict: i === 2 ? "NEUTRAL" : "LIKE",
      reorder_intent: "YES",
      short_note:
        i === 2 ? "오늘은 튀김이 조금 눅눅했다." : "역시 기본이 가장 좋다.",
      detailed_note: "",
      eaten_at: d.toISOString().slice(0, 10),
      dining_context: "TAKEOUT",
      tags: ["혼밥"],
      photos: [],
    });
  }
  return a;
}
