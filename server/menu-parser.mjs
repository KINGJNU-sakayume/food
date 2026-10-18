// Only explicit menu entities in public JSON are accepted. No script execution.
const clean = (value) =>
  typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .trim()
        .slice(0, 200)
    : "";
const isType = (node, pattern) =>
  (Array.isArray(node["@type"])
    ? node["@type"]
    : [node["@type"] || node.__typename || ""]
  ).some((t) => pattern.test(String(t)));
function jsonObjects(html) {
  const blocks = [];
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (
      /type\s*=\s*["']application\/ld\+json["']|id\s*=\s*["']__NEXT_DATA__["']/i.test(
        match[1],
      )
    ) {
      try {
        blocks.push(JSON.parse(match[2]));
      } catch {}
    }
    const start = match[2].indexOf("window.__APOLLO_STATE__");
    if (start < 0) continue;
    const assignment = match[2]
      .slice(start)
      .match(/^window\.__APOLLO_STATE__\s*=\s*/);
    if (!assignment) continue;
    const raw = match[2].slice(start + assignment[0].length);
    let depth = 0,
      inString = false,
      escape = false;
    for (let i = 0; i < Math.min(raw.length, 2_000_000); i++) {
      const c = raw[i];
      if (inString) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          try {
            blocks.push(JSON.parse(raw.slice(0, i + 1)));
          } catch {}
          break;
        }
      }
    }
  }
  return blocks;
}
export function parseMenuPage(html, sourceUrl) {
  const roots = jsonObjects(html),
    nodes = [];
  let visited = 0;
  function walk(value, depth = 0) {
    if (depth > 25 || visited++ > 25000 || !value || typeof value !== "object")
      return;
    if (!Array.isArray(value)) nodes.push(value);
    for (const child of Object.values(value)) walk(child, depth + 1);
  }
  roots.forEach((root) => walk(root));
  const restaurant = nodes.find((n) =>
    isType(n, /^(Restaurant|CafeOrCoffeeShop|Bakery|FoodEstablishment)$/i),
  );
  const meta = (property) => {
    for (const m of html.matchAll(/<meta\b([^>]+)>/gi)) {
      const attrs = Object.fromEntries(
        [...m[1].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((x) => [
          x[1].toLowerCase(),
          x[2],
        ]),
      );
      if (attrs.property === property || attrs.name === property)
        return clean(attrs.content);
    }
    return "";
  };
  const title =
    clean(restaurant?.name) ||
    meta("og:title").replace(/\s*[:|]\s*(네이버.*|배달의민족.*)$/, "") ||
    clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const address =
    typeof restaurant?.address === "string"
      ? clean(restaurant.address)
      : clean(restaurant?.address?.streetAddress);
  const byId = new Map(nodes.filter((n) => n["@id"]).map((n) => [n["@id"], n]));
  const resolve = (n) =>
    n && typeof n === "object" && n["@id"] ? byId.get(n["@id"]) || n : n;
  const menus = [];
  const seen = new Set();
  for (const node of nodes) {
    if (
      !isType(node, /^(MenuItem|RestaurantMenu|Menu)$/i) ||
      (isType(node, /^Menu$/i) && !node.price && !node.offers)
    )
      continue;
    const name = clean(node.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const offer =
      resolve(Array.isArray(node.offers) ? node.offers[0] : node.offers) || {};
    const rawPrice = offer.price ?? node.price;
    const number =
      typeof rawPrice === "number"
        ? rawPrice
        : typeof rawPrice === "string" &&
            /^[\d,]+(?:\.\d+)?(?:\s*원)?$/.test(rawPrice)
          ? Number(rawPrice.replace(/[,\s원]/g, ""))
          : undefined;
    const currency = offer.priceCurrency || "KRW";
    menus.push({
      name,
      external_id: clean(node["@id"] || node.id) || undefined,
      category: clean(node.menuSection) || undefined,
      price:
        currency === "KRW" && Number.isFinite(number) && number >= 0
          ? number
          : undefined,
      source_url: sourceUrl,
    });
    if (menus.length === 500) break;
  }
  return {
    name: title,
    address,
    menus,
    menu_status: menus.length ? "available" : "unavailable",
    source_url: sourceUrl,
  };
}
