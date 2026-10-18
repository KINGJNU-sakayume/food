import test from "node:test";
import assert from "node:assert/strict";
import { parseMenuPage } from "../server/menu-parser.mjs";
import worker from "../server/restaurant-worker.mjs";
const source = "https://restaurant.example/menu";
test("public structured menus expose actual items and KRW prices, without guessing navigation labels", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@graph": [
      {
        "@type": "Restaurant",
        name: "작은 식당",
        address: { streetAddress: "서울" },
        hasMenu: { "@id": "menu" },
      },
      {
        "@id": "menu",
        "@type": "Menu",
        hasMenuItem: [
          {
            "@type": "MenuItem",
            name: "우동",
            offers: { price: "9,000", priceCurrency: "KRW" },
          },
          {
            "@type": "MenuItem",
            name: "소바",
            offers: { price: 10, priceCurrency: "USD" },
          },
        ],
      },
    ],
  })}</script><script>{"name":"장바구니"}</script>`;
  const result = parseMenuPage(html, source);
  assert.equal(result.name, "작은 식당");
  assert.equal(result.menus.length, 2);
  assert.equal(result.menus[0].price, 9000);
  assert.equal(result.menus[1].price, undefined);
  assert.equal(result.menu_status, "available");
});
test("embedded public Apollo menu JSON is parsed as JSON and never evaluated", () => {
  const html = `<meta property="og:title" content="동네 식당 : 네이버"><script>window.__APOLLO_STATE__ = ${JSON.stringify({ "Menu:1": { __typename: "Menu", id: "1", name: "김치찌개", price: "10,000원" }, "Restaurant:1": { __typename: "Restaurant", name: "동네 식당" } })};window.executed=true;</script>`;
  const parsed = parseMenuPage(html, source);
  assert.equal(parsed.menus[0].name, "김치찌개");
  assert.equal(parsed.menus[0].price, 10000);
  assert.equal(globalThis.executed, undefined);
});
test("missing or malformed menus stay unavailable instead of fabricating a restaurant menu", () => {
  for (const html of [
    "<title>식당</title>",
    '<script type="application/ld+json">broken</script>',
    '<script>{"name":"메뉴","items":[{"name":"로그인"}]}</script>',
  ]) {
    assert.equal(parseMenuPage(html, source).menu_status, "unavailable");
    assert.equal(parseMenuPage(html, source).menus.length, 0);
  }
});
test("lookup service refuses other origins, methods and arbitrary network targets", async () => {
  const env = { ALLOWED_ORIGIN: "https://palate.example" };
  const req = (url, origin = "https://palate.example", method = "GET") =>
    new Request(url, { method, headers: { Origin: origin } });
  assert.equal(
    (
      await worker.fetch(
        req("https://api.example/search?q=test", "https://evil.example"),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        req(
          "https://api.example/search?q=test",
          "https://palate.example",
          "POST",
        ),
        env,
      )
    ).status,
    405,
  );
  assert.equal(
    (
      await worker.fetch(
        req("https://api.example/details?url=https://127.0.0.1/internal"),
        env,
      )
    ).status,
    422,
  );
  assert.equal(
    (await worker.fetch(req("https://api.example/search?q=test"), env)).status,
    503,
  );
});
test("a public redirect cannot turn the menu service into a private network proxy", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { Location: "https://127.0.0.1/secret" },
    });
  };
  try {
    const response = await worker.fetch(
      new Request("https://api.example/details?url=https://naver.me/AbC", {
        headers: { Origin: "https://palate.example" },
      }),
      { ALLOWED_ORIGIN: "https://palate.example" },
    );
    assert.equal(response.status, 422);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
