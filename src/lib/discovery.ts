import type {
  Archive,
  Brand,
  LinkTarget,
  Menu,
  Place,
  TargetType,
} from "../types/model.js";
import { id, normalize } from "./data.js";
import { sharedUrl, sourceOf } from "./urls.js";

export interface CatalogBrand {
  key: string;
  name: string;
  category: string;
  source_url: string;
  menus: string[];
}
export interface RestaurantResult {
  name: string;
  address: string;
  source_url?: string;
  external_provider?: string;
  external_place_id?: string;
  brand_id?: string;
}
export interface ImportedMenu {
  name: string;
  category?: string;
  external_id?: string;
  price?: number;
  source_url?: string;
}
export interface RestaurantDetails extends RestaurantResult {
  menus: ImportedMenu[];
  menu_status: "available" | "unavailable";
  checked_at: string;
}
export function isWanted(a: Archive, type: TargetType, targetId: string) {
  return a.wishes.some(
    (w) => w.target_type === type && w.target_id === targetId,
  );
}
export function toggleWish(
  a: Archive,
  type: TargetType,
  targetId: string,
): Archive {
  if (
    !(type === "MENU" ? a.menus : type === "PLACE" ? a.places : a.brands).some(
      (x) => x.id === targetId,
    )
  )
    throw new Error("관심 대상으로 저장할 항목을 찾을 수 없습니다.");
  const exists = isWanted(a, type, targetId);
  return {
    ...a,
    wishes: exists
      ? a.wishes.filter(
          (w) => !(w.target_type === type && w.target_id === targetId),
        )
      : [
          ...a.wishes,
          {
            id: id(),
            user_id: a.user.id,
            created_at: new Date().toISOString(),
            target_type: type,
            target_id: targetId,
          },
        ],
  };
}
export function addCatalog(a: Archive, catalog: CatalogBrand) {
  const next = structuredClone(a),
    now = new Date().toISOString(),
    owned = () => ({ id: id(), user_id: a.user.id, created_at: now });
  let brand = next.brands.find(
    (b) =>
      b.catalog_key === catalog.key ||
      b.normalized_name === normalize(catalog.name),
  );
  if (!brand) {
    brand = {
      ...owned(),
      name: catalog.name,
      normalized_name: normalize(catalog.name),
      catalog_key: catalog.key,
      source_url: catalog.source_url,
    };
    next.brands.push(brand);
  } else {
    brand.catalog_key = catalog.key;
    brand.source_url = catalog.source_url;
  }
  for (const name of catalog.menus)
    if (
      !next.menus.some(
        (m) => m.brand_id === brand.id && m.normalized_name === normalize(name),
      )
    )
      next.menus.push({
        ...owned(),
        name,
        normalized_name: normalize(name),
        brand_id: brand.id,
        category: catalog.category,
        active: true,
        discovered: true,
        source_url: catalog.source_url,
      });
  return { archive: next, brandId: brand.id };
}
export function savePlace(a: Archive, result: RestaurantResult) {
  if (!result.name.trim() || result.name.length > 200)
    throw new Error("음식점 이름을 확인해 주세요.");
  const next = structuredClone(a);
  let place =
    next.places.find(
      (p) =>
        result.external_provider &&
        result.external_place_id &&
        p.external_provider === result.external_provider &&
        p.external_place_id === result.external_place_id,
    ) ||
    next.places.find(
      (p) =>
        p.normalized_name === normalize(result.name) &&
        normalize(p.address || "") === normalize(result.address || ""),
    );
  if (!place) {
    place = {
      id: id(),
      user_id: next.user.id,
      created_at: new Date().toISOString(),
      name: result.name.trim(),
      normalized_name: normalize(result.name),
      address: result.address,
      source_url: result.source_url,
      external_provider: result.external_provider,
      external_place_id: result.external_place_id,
      brand_id: result.brand_id,
      place_type: "RESTAURANT",
    };
    next.places.push(place);
  } else {
    place.source_url = result.source_url || place.source_url;
    place.external_provider =
      result.external_provider || place.external_provider;
    place.external_place_id =
      result.external_place_id || place.external_place_id;
  }
  return { archive: next, placeId: place.id };
}
export function addMenuToVenue(
  a: Archive,
  target: LinkTarget,
  name: string,
  category = "",
) {
  if (!name.trim() || name.length > 200)
    throw new Error("메뉴 이름을 입력해 주세요.");
  const next = structuredClone(a),
    venue =
      target.type === "BRAND"
        ? next.brands.find((b) => b.id === target.id)
        : next.places.find((p) => p.id === target.id);
  if (!venue || target.type === "MENU")
    throw new Error("음식점을 찾을 수 없습니다.");
  const place = target.type === "PLACE" ? (venue as Place) : undefined,
    brandId = target.type === "BRAND" ? target.id : place?.brand_id;
  let menu = next.menus.find(
    (m) =>
      m.normalized_name === normalize(name) &&
      (brandId
        ? m.brand_id === brandId
        : m.place_id === target.id ||
          next.offerings.some(
            (o) => o.menu_id === m.id && o.place_id === target.id,
          )),
  );
  if (!menu) {
    menu = {
      id: id(),
      user_id: a.user.id,
      created_at: new Date().toISOString(),
      name: name.trim(),
      normalized_name: normalize(name),
      category,
      brand_id: brandId,
      place_id: brandId ? undefined : place?.id,
      active: true,
      discovered: true,
    };
    next.menus.push(menu);
  }
  if (
    place &&
    !next.offerings.some(
      (o) => o.place_id === place.id && o.menu_id === menu.id,
    )
  )
    next.offerings.push({
      id: id(),
      user_id: a.user.id,
      created_at: new Date().toISOString(),
      menu_id: menu.id,
      place_id: place.id,
      currency: "KRW",
      available: true,
    });
  return { archive: next, menuId: menu.id };
}
export function applyRestaurantDetails(
  a: Archive,
  placeId: string,
  details: RestaurantDetails,
): Archive {
  let next = structuredClone(a);
  const place = next.places.find((p) => p.id === placeId);
  if (!place) throw new Error("음식점을 찾을 수 없습니다.");
  // An unsuccessful fetch never erases the last good menu list or check date.
  if (details.menu_status !== "available" || !details.menus.length) return next;
  for (const item of details.menus) {
    let menu = next.menus.find(
      (m) =>
        item.external_id &&
        m.external_menu_id === item.external_id &&
        (m.place_id === place.id ||
          next.offerings.some(
            (o) => o.menu_id === m.id && o.place_id === place.id,
          )),
    );
    if (!menu) {
      const saved = addMenuToVenue(
        next,
        { type: "PLACE", id: place.id },
        item.name,
        item.category,
      );
      next = saved.archive;
      menu = next.menus.find((m) => m.id === saved.menuId)!;
    }
    menu.external_menu_id = item.external_id || menu.external_menu_id;
    menu.source_url = item.source_url || details.source_url;
    const offering = next.offerings.find(
      (o) => o.menu_id === menu.id && o.place_id === place.id,
    )!;
    if (item.price !== undefined) offering.price = item.price;
  }
  const updated = next.places.find((p) => p.id === placeId)!;
  updated.menus_checked_at = details.checked_at;
  updated.source_url = details.source_url || updated.source_url;
  return next;
}
export function saveSharedLink(a: Archive, text: string, title = "") {
  const url = sharedUrl(text),
    existing = a.saved_links.find((l) => l.url === url);
  if (existing) return { archive: a, linkId: existing.id, duplicate: true };
  const now = new Date().toISOString(),
    kind = sourceOf(url) === "INSTAGRAM" ? "REEL" : "PLACE";
  const link = {
    id: id(),
    user_id: a.user.id,
    created_at: now,
    updated_at: now,
    url,
    kind,
    title:
      title.trim().slice(0, 200) ||
      (kind === "REEL" ? "아직 이름 붙이지 않은 맛" : "저장한 음식점 링크"),
    note: "",
    targets: [],
  } as const;
  return {
    archive: {
      ...a,
      saved_links: [{ ...link, targets: [] }, ...a.saved_links],
    },
    linkId: link.id,
    duplicate: false,
  };
}
export function updateSavedLink(
  a: Archive,
  linkId: string,
  title: string,
  note: string,
  targets: LinkTarget[],
): Archive {
  return {
    ...a,
    saved_links: a.saved_links.map((l) =>
      l.id === linkId
        ? {
            ...l,
            title: title.trim() || l.title,
            note: note.trim(),
            targets,
            updated_at: new Date().toISOString(),
          }
        : l,
    ),
  };
}
export function venueMenus(a: Archive, target: LinkTarget): Menu[] {
  const place =
    target.type === "PLACE"
      ? a.places.find((p) => p.id === target.id)
      : undefined;
  return a.menus.filter((m) =>
    target.type === "BRAND"
      ? m.brand_id === target.id
      : m.place_id === target.id ||
        a.offerings.some(
          (o) => o.menu_id === m.id && o.place_id === target.id,
        ) ||
        (!!place?.brand_id && m.brand_id === place.brand_id),
  );
}
export function venueTitle(a: Archive, target: LinkTarget): string {
  return (
    (target.type === "BRAND"
      ? a.brands
      : target.type === "PLACE"
        ? a.places
        : a.menus
    ).find((x) => x.id === target.id)?.name || "연결한 항목"
  );
}
