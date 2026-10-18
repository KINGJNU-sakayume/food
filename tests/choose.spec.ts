import { test, expect, type Page } from "@playwright/test";
const KEY = "palate.archive.v1";
const archive = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
async function chooseBrand(page: Page) {
  await page.goto("/#/choose/franchises");
  await page
    .locator(".franchise-tile")
    .filter({
      has: page.getByRole("heading", { name: "맘스터치", exact: true }),
    })
    .getByRole("button")
    .click();
  await expect(page.locator(".choice-menu-row")).toHaveCount(6);
}
test("choose a franchise, compare experience and consume a menu wish after eating", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("main h1")).toHaveText("먹어온 것들.");
  await chooseBrand(page);
  let data = await archive(page);
  expect(data.records).toHaveLength(0);
  expect(data.menus.every((m: { discovered: boolean }) => m.discovered)).toBe(
    true,
  );
  const burger = page.locator(".choice-menu-row").filter({
    has: page.getByRole("heading", { name: "싸이버거", exact: true }),
  });
  await expect(burger).toContainText("아직 안 먹음");
  await page
    .locator(".venue-heading")
    .getByRole("button", { name: "가보고 싶다", exact: true })
    .click();
  await burger.getByRole("button", { name: "먹고 싶다", exact: true }).click();
  await expect(
    burger.getByRole("button", { name: "먹고 싶다", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("link", { name: "Collection 컬렉션" })
    .click();
  await expect(
    page.getByRole("button", { name: "첫 식사 기록하기" }),
  ).toBeVisible();
  await expect(page.locator(".menu-tile")).toHaveCount(0);
  await page.goto("/#/choose");
  await page.getByRole("heading", { name: "맘스터치", exact: true }).click();
  await burger.getByRole("button", { name: "먹었다", exact: true }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByLabel("메뉴 필수")).toHaveValue("싸이버거");
  await form.getByRole("button", { name: "− 불호", exact: true }).click();
  await form
    .getByRole("button", { name: "다시 안 먹는다", exact: true })
    .click();
  await form
    .getByRole("button", { name: "기억 저장하기", exact: true })
    .click();
  await expect(burger).toContainText("불호");
  await expect(burger).toContainText("1번 먹음");
  await expect(
    burger.getByRole("button", { name: "먹고 싶다", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page
      .locator(".venue-heading")
      .getByRole("button", { name: "가보고 싶다", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("link", { name: "Collection 컬렉션" })
    .click();
  await expect(page.locator(".menu-tile")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("iPhone shortcut receiver deduplicates links and multi-target organisation survives reload and backup", async ({
  page,
}) => {
  await chooseBrand(page);
  const before = await archive(page);
  const share =
    "봐봐 https://www.instagram.com/reel/PALATE_TEST/?igsh=tracking";
  await page.goto("/#/receive?text=" + encodeURIComponent(share));
  await expect(page.locator(".saved-link")).toHaveCount(1);
  await expect(page.locator(".received-notice")).toContainText(
    "공유한 링크를 보관",
  );
  await page.goto(
    "/#/receive?text=" + encodeURIComponent(share.replace("tracking", "again")),
  );
  await expect(page.locator(".saved-link")).toHaveCount(1);
  await expect(page.locator(".received-notice")).toContainText(
    "중복으로 추가하지",
  );
  await page.getByRole("button", { name: "이름·메모·연결" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("기억할 이름").fill("다음에 시도할 버거");
  await d.getByLabel("짧은 메모").fill("두 가지 메뉴 비교");
  await d.getByLabel("연결할 항목 종류").selectOption("BRAND");
  await d
    .locator(".connection-list")
    .getByRole("button", { name: "맘스터치" })
    .click();
  await d.getByLabel("연결할 항목 종류").selectOption("MENU");
  await d.getByLabel("연결할 항목 검색").fill("싸이버거");
  await d
    .locator(".connection-list")
    .getByRole("button", { name: "싸이버거", exact: true })
    .click();
  await d.getByRole("button", { name: "정리한 내용 저장" }).click();
  await page.reload();
  await expect(page.locator(".saved-link")).toContainText("다음에 시도할 버거");
  let data = await archive(page);
  expect(data.saved_links[0].targets).toHaveLength(2);
  expect(data.records).toEqual(before.records);
  await page.getByRole("button", { name: "아카이브 설정과 백업" }).click();
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 백업" }).click();
  expect((await wait).suggestedFilename()).toMatch(/\.json$/);
  await page
    .getByRole("dialog")
    .locator("input[type=file]")
    .setInputFiles({
      name: "backup-v2.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await expect(page.getByRole("dialog")).toContainText("보관한 링크 1개");
  await page.getByRole("button", { name: "이 백업으로 복원" }).click();
  await page
    .getByRole("button", { name: "다음에 시도할 버거 보관한 링크 삭제" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "링크 삭제", exact: true })
    .click();
  data = await archive(page);
  expect(data.saved_links).toHaveLength(0);
  expect(data.menus).toHaveLength(6);
});
test("restaurant name search is explicit and saves the selected real provider result", async ({
  page,
}) => {
  let calls = 0;
  await page.route(/photon\.komoot\.io\/api/, async (route) => {
    calls++;
    expect(new URL(route.request().url()).searchParams.get("q")).toBe(
      "테스트 식당 서울",
    );
    await route.fulfill({
      json: {
        features: [
          {
            properties: {
              osm_type: "N",
              osm_id: 123,
              osm_key: "amenity",
              osm_value: "restaurant",
              name: "테스트 식당",
              city: "서울",
              district: "마포구",
              countrycode: "KR",
            },
          },
        ],
      },
    });
  });
  await page.goto("/#/choose");
  await page.getByRole("button", { name: "음식점 추가", exact: true }).click();
  await page.getByLabel("음식점 이름과 지역").fill("테스트 식당 서울");
  expect(calls).toBe(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "검색", exact: true })
    .click();
  await page.locator(".place-results").getByRole("button").click();
  await page.getByRole("button", { name: "내 음식점에 저장" }).click();
  await expect(page.locator(".venue-heading h1")).toHaveText("테스트 식당");
  const data = await archive(page);
  expect(data.places[0].external_place_id).toBe("node/123");
  expect(data.records).toHaveLength(0);
  expect(calls).toBe(1);
});
test("configured menu lookup imports real response items and preserves them when refresh is unavailable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "아카이브 설정과 백업" }).click();
  await page.getByText("음식점 정보 연결 · 고급 설정", { exact: true }).click();
  await page
    .getByLabel("음식점 조회 서비스 주소")
    .fill("https://menu-provider.example");
  await page.getByRole("button", { name: "연결 설정 저장" }).click();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  let success = true;
  await page.route(
    "https://menu-provider.example/details?**",
    async (route) => {
      expect(new URL(route.request().url()).searchParams.get("url")).toBe(
        "https://naver.me/TestPlace",
      );
      await route.fulfill({
        json: {
          name: "작은 식당",
          address: "서울 마포구",
          source_url: "https://naver.me/TestPlace",
          external_provider: "NAVER",
          external_place_id: "123",
          menus: success
            ? [{ name: "들기름 막국수", external_id: "menu1", price: 11000 }]
            : [],
        },
      });
    },
  );
  await page.goto("/#/choose");
  await page.getByRole("button", { name: "음식점 추가", exact: true }).click();
  await page
    .getByRole("button", { name: "링크 가져오기", exact: true })
    .click();
  await page
    .getByLabel("네이버지도·배민·음식점 링크")
    .fill("https://naver.me/TestPlace");
  await page
    .getByRole("button", { name: "정보 불러오기", exact: true })
    .click();
  await expect(page.getByLabel("음식점 이름", { exact: true })).toHaveValue(
    "작은 식당",
  );
  await page.getByRole("button", { name: "메뉴 1개와 함께 저장" }).click();
  await expect(page.locator(".choice-menu-row")).toContainText("들기름 막국수");
  await expect(page.locator(".choice-menu-row")).toContainText("₩11,000");
  await page
    .locator(".choice-menu-row")
    .getByRole("button", { name: "먹고 싶다", exact: true })
    .click();
  const before = await archive(page);
  success = false;
  await page
    .getByRole("button", { name: "메뉴 불러오기", exact: true })
    .click();
  await expect(page.locator(".inline-notice[role=status]")).toContainText(
    "기존 메뉴와 기록은 유지",
  );
  const after = await archive(page);
  expect(after.menus).toEqual(before.menus);
  expect(after.wishes).toEqual(before.wishes);
  expect(after.places[0].menus_checked_at).toBe(
    before.places[0].menus_checked_at,
  );
});
test("v1 storage is read without overwriting it until a new action is saved", async ({
  page,
}) => {
  const legacy = {
    schema_version: 1,
    user: {
      id: "legacy-user",
      display_name: "기존 기록",
      created_at: "2026-10-01T00:00:00Z",
    },
    brands: [],
    places: [],
    menus: [],
    offerings: [],
    records: [],
    photos: [],
    tags: [],
    record_tags: [],
    demo: false,
  };
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    { key: KEY, value: JSON.stringify(legacy) },
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "첫 식사 기록하기" }),
  ).toBeVisible();
  expect((await archive(page)).schema_version).toBe(1);
  await page.goto(
    "/#/receive?text=" +
      encodeURIComponent("https://www.instagram.com/reel/PALATE_OLD/"),
  );
  await expect(page.locator(".saved-link")).toHaveCount(1);
  const data = await archive(page);
  expect(data.schema_version).toBe(2);
  expect(data.user.id).toBe("legacy-user");
  await page.goto(
    "/#/receive?text=" + encodeURIComponent("javascript:alert(1)"),
  );
  await expect(page.locator("main [role=alert]")).toContainText("https 링크");
  expect((await archive(page)).saved_links).toHaveLength(1);
});
test("mobile choose pages and shortcut guidance fit an iPhone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseBrand(page);
  for (const path of ["/choose", "/choose/franchises", "/choose/reels"]) {
    await page.goto("/#" + path);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "아이폰 공유 설정" }).click();
  const d = page.getByRole("dialog");
  await expect(d).toContainText("URL 인코딩");
  await expect(d.locator(".shortcut-url")).toContainText("/#/receive?text=");
  expect(
    await d.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/#/choose/franchises");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("franchise menus and intentions can be used offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await chooseBrand(page);
  const row = page.locator(".choice-menu-row").first();
  await row.getByRole("button", { name: "먹고 싶다", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "먹고 싶다", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page
      .locator(".choice-menu-row")
      .first()
      .getByRole("button", { name: "먹고 싶다", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await context.setOffline(false);
});

test("a stale tab applies a new intention to the latest archive without losing a shared link", async ({
  page,
  context,
}) => {
  await page.addInitScript(() =>
    window.addEventListener(
      "storage",
      (event) => event.stopImmediatePropagation(),
      true,
    ),
  );
  await chooseBrand(page);
  const incoming = await context.newPage();
  await incoming.goto(
    "/#/receive?text=" +
      encodeURIComponent("https://www.instagram.com/reel/PALATE_SECOND_TAB/"),
  );
  await expect(incoming.locator(".saved-link")).toHaveCount(1);
  await page
    .locator(".choice-menu-row")
    .first()
    .getByRole("button", { name: "먹고 싶다", exact: true })
    .click();
  const data = await archive(page);
  expect(data.saved_links).toHaveLength(1);
  expect(data.wishes).toHaveLength(1);
  expect(data.menus).toHaveLength(6);
});
