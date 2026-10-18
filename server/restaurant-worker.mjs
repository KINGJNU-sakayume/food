import { parseMenuPage } from "./menu-parser.mjs";
const coreHosts = [
  "naver.me",
  "map.naver.com",
  "m.place.naver.com",
  "pcmap.place.naver.com",
  "place.naver.com",
  "baemin.me",
  "baemin.com",
  "www.baemin.com",
  "baemin.app.link",
];
function safeUrl(value, env) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error("올바른 음식점 링크를 입력해 주세요.");
  }
  const allowed = [
    ...coreHosts,
    ...(env.ALLOWED_MENU_HOSTS || "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  ];
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !allowed.includes(u.hostname.toLowerCase())
  )
    throw new Error("이 출처의 메뉴 연결은 지원하지 않습니다.");
  return u;
}
async function publicPage(url, env) {
  let current = safeUrl(url, env);
  for (let i = 0; i < 5; i++) {
    const res = await fetch(current, {
      redirect: "manual",
      headers: { Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(10000),
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) throw new Error("음식점 링크를 열 수 없습니다.");
      current = safeUrl(new URL(location, current).href, env);
      continue;
    }
    if (!res.ok)
      throw new Error(
        "출처에서 음식점 정보를 제공하지 않았습니다. 저장한 정보는 유지됩니다.",
      );
    if (!res.headers.get("content-type")?.includes("text/html"))
      throw new Error("음식점 웹페이지 링크를 확인해 주세요.");
    const reader = res.body.getReader();
    let size = 0,
      chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new Error("음식점 페이지가 너무 큽니다.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { html: new TextDecoder().decode(bytes), url: current };
  }
  throw new Error("음식점 링크의 이동이 너무 많습니다.");
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin"),
      allowed = env.ALLOWED_ORIGIN;
    if (!allowed || origin !== allowed)
      return new Response("Forbidden", { status: 403 });
    const headers = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      Vary: "Origin",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    };
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "GET")
      return new Response(
        JSON.stringify({ error: "조회 요청만 지원합니다." }),
        { status: 405, headers },
      );
    try {
      const u = new URL(request.url);
      if (u.pathname === "/search") {
        if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET)
          return new Response(
            JSON.stringify({
              error: "음식점 검색 연결이 준비되지 않았습니다.",
            }),
            { status: 503, headers },
          );
        const query = u.searchParams.get("q")?.trim();
        if (!query || query.length < 2 || query.length > 100)
          throw new Error("음식점 이름을 확인해 주세요.");
        const api = new URL("https://openapi.naver.com/v1/search/local.json");
        api.search = new URLSearchParams({ query, display: "5" }).toString();
        const res = await fetch(api, {
          headers: {
            "X-Naver-Client-Id": env.NAVER_CLIENT_ID,
            "X-Naver-Client-Secret": env.NAVER_CLIENT_SECRET,
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error("음식점 검색 연결을 확인해 주세요.");
        const data = await res.json();
        return new Response(
          JSON.stringify({
            results: data.items
              .filter((x) => typeof x.title === "string")
              .map((x) => ({
                name: x.title.replace(/<[^>]*>/g, ""),
                address: x.roadAddress || x.address || "",
                source_url:
                  typeof x.link === "string" && x.link.startsWith("https://")
                    ? x.link
                    : undefined,
                external_provider: "NAVER_SEARCH",
                external_place_id: `${x.mapx}:${x.mapy}:${x.title.replace(/<[^>]*>/g, "")}`,
              })),
          }),
          { headers },
        );
      }
      if (u.pathname === "/details") {
        let target = safeUrl(u.searchParams.get("url") || "", env);
        const placeId =
          target.pathname.match(/(?:restaurant|place)\/(\d+)/)?.[1] ||
          target.searchParams.get("id");
        if (
          target.hostname.includes("naver.com") &&
          placeId &&
          /^\d+$/.test(placeId)
        )
          target = new URL(
            `https://m.place.naver.com/restaurant/${placeId}/menu`,
          );
        const page = await publicPage(target.href, env),
          details = parseMenuPage(page.html, page.url.href);
        if (!details.name) throw new Error("음식점 이름을 확인할 수 없습니다.");
        const resolvedId = page.url.pathname.match(
          /(?:restaurant|place)\/(\d+)/,
        )?.[1];
        return new Response(
          JSON.stringify({
            ...details,
            external_provider: page.url.hostname.includes("naver")
              ? "NAVER"
              : "WEB",
            external_place_id: resolvedId,
            checked_at: new Date().toISOString(),
          }),
          { headers },
        );
      }
      return new Response(
        JSON.stringify({ error: "지원하지 않는 조회입니다." }),
        { status: 404, headers },
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error:
            error instanceof Error
              ? error.message
              : "음식점 정보를 불러오지 못했습니다.",
        }),
        { status: 422, headers },
      );
    }
  },
};
