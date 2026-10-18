import type { RestaurantDetails, RestaurantResult } from "./discovery.js";
import { httpsUrl } from "./urls.js";

export interface RestaurantProvider {
  search(query: string, signal?: AbortSignal): Promise<RestaurantResult[]>;
  details(url: string, signal?: AbortSignal): Promise<RestaurantDetails>;
}
export const defaultEndpoint = () =>
  httpsUrl(import.meta.env.VITE_RESTAURANT_API_URL) || "";
const cache = new Map<string, { time: number; results: RestaurantResult[] }>();
let nextSearch = 0;
const text = (v: unknown, max = 200) =>
  typeof v === "string"
    ? v
        .replace(/<[^>]*>/g, "")
        .trim()
        .slice(0, max)
    : "";
function result(value: unknown): RestaurantResult | undefined {
  if (!value || typeof value !== "object") return;
  const r = value as Record<string, unknown>,
    name = text(r.name);
  if (!name) return;
  return {
    name,
    address: text(r.address, 2000),
    source_url: httpsUrl(r.source_url),
    external_provider: text(r.external_provider, 100) || undefined,
    external_place_id: text(r.external_place_id, 200) || undefined,
  };
}
async function jsonResponse(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : "음식점 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
  return response.json();
}
export function restaurantProvider(endpoint: string): RestaurantProvider {
  const base = httpsUrl(endpoint);
  return {
    async search(query, signal) {
      const q = query.trim();
      if (q.length < 2)
        throw new Error("음식점 이름을 두 글자 이상 입력해 주세요.");
      const key = (base || "photon") + ":" + q,
        cached = cache.get(key);
      if (cached && Date.now() - cached.time < 30 * 60 * 1000)
        return cached.results;
      const wait = Math.max(0, nextSearch - Date.now());
      nextSearch = Date.now() + wait + 1200;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, wait);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      let results: RestaurantResult[];
      if (base) {
        const url = new URL(base.replace(/\/$/, "") + "/search");
        url.searchParams.set("q", q);
        const data = await jsonResponse(
          await fetch(url, { signal, referrerPolicy: "origin" }),
        );
        if (!Array.isArray(data.results))
          throw new Error("음식점 검색 결과의 형식을 확인해 주세요.");
        results = data.results
          .map(result)
          .filter(
            (r: RestaurantResult | undefined): r is RestaurantResult => !!r,
          )
          .slice(0, 20);
      } else {
        const url = new URL("https://photon.komoot.io/api/");
        url.search = new URLSearchParams({
          q,
          limit: "20",
          bbox: "124,33,132,39",
        }).toString();
        const data = await jsonResponse(
          await fetch(url, { signal, referrerPolicy: "origin" }),
        );
        if (!Array.isArray(data.features))
          throw new Error("음식점 검색 결과를 읽지 못했습니다.");
        const foodTypes = [
          "restaurant",
          "cafe",
          "fast_food",
          "bar",
          "pub",
          "food_court",
          "bakery",
          "ice_cream",
          "convenience",
          "coffee",
          "pastry",
          "confectionery",
        ];
        results = data.features
          .map((f: { properties?: Record<string, unknown> }) => f?.properties)
          .filter(
            (
              r: Record<string, unknown> | undefined,
            ): r is Record<string, unknown> =>
              !!r &&
              ["amenity", "shop"].includes(String(r.osm_key)) &&
              foodTypes.includes(String(r.osm_value)) &&
              (!r.countrycode || r.countrycode === "KR"),
          )
          .map((r: Record<string, unknown>) => {
            const kind = (
              { N: "node", W: "way", R: "relation" } as Record<string, string>
            )[String(r.osm_type)];
            if (!kind || !Number.isSafeInteger(r.osm_id)) return undefined;
            return {
              name: text(r.name),
              address: [
                ...new Set(
                  [
                    r.state,
                    r.city,
                    r.district,
                    r.locality,
                    r.street,
                    r.housenumber,
                  ]
                    .map((v) => text(v))
                    .filter(Boolean),
                ),
              ].join(" "),
              source_url: `https://www.openstreetmap.org/${kind}/${r.osm_id}`,
              external_provider: "OPENSTREETMAP",
              external_place_id: `${kind}/${r.osm_id}`,
            };
          })
          .filter(
            (r: RestaurantResult | undefined): r is RestaurantResult =>
              !!r?.name,
          )
          .slice(0, 8);
      }
      if (cache.size >= 40) cache.delete(cache.keys().next().value!);
      cache.set(key, { time: Date.now(), results });
      return results;
    },
    async details(source, signal) {
      if (!base)
        throw new Error(
          "이 음식점의 자동 메뉴 연결이 준비되지 않았습니다. 연결 설정 후 다시 불러올 수 있습니다.",
        );
      const safe = httpsUrl(source);
      if (!safe) throw new Error("음식점의 https 링크를 확인해 주세요.");
      const url = new URL(base.replace(/\/$/, "") + "/details");
      url.searchParams.set("url", safe);
      const data = await jsonResponse(await fetch(url, { signal })),
        venue = result(data);
      if (!venue || !Array.isArray(data.menus) || data.menus.length > 500)
        throw new Error("불러온 메뉴 정보를 읽지 못했습니다.");
      const menus = data.menus
        .map((m: Record<string, unknown>) => ({
          name: text(m.name),
          category: text(m.category, 100) || undefined,
          external_id: text(m.external_id, 300) || undefined,
          source_url: httpsUrl(m.source_url),
          price:
            typeof m.price === "number" &&
            Number.isFinite(m.price) &&
            m.price >= 0
              ? m.price
              : undefined,
        }))
        .filter((m: { name: string }) => !!m.name);
      return {
        ...venue,
        menus,
        menu_status: menus.length ? "available" : "unavailable",
        checked_at: new Date().toISOString(),
      };
    },
  };
}
