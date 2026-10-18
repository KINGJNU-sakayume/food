import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const KEY = "palate.archive.v1";
async function create(page: Page, name = "테스트 로스카츠") {
  await page.getByRole("button", { name: "첫 식사 기록하기" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("메뉴 필수").fill(name);
  await dialog.getByRole("button", { name: "+ 호", exact: true }).click();
  await dialog
    .getByRole("button", { name: "다시 안 먹는다", exact: true })
    .click();
  await dialog.getByLabel("한 줄 기억").fill("소금과 잘 어울리는 메뉴");
  await dialog
    .getByRole("button", { name: "기억 저장하기", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}
test("quick add, repeated meals, edit, delete, persistence, JSON and photos", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await create(page);
  await expect(
    page.getByRole("heading", { name: "테스트 로스카츠", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "테스트 로스카츠", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link")
    .filter({
      has: page.getByRole("heading", { name: "테스트 로스카츠", exact: true }),
    })
    .click();
  await page.getByRole("button", { name: "메뉴 정보 수정" }).click();
  await page
    .locator(".menu-edit")
    .getByLabel("브랜드", { exact: true })
    .fill("식당 브랜드");
  await page.getByRole("button", { name: "정보 저장", exact: true }).click();
  await page.getByRole("button", { name: "다시 먹은 기록" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "= 보통", exact: true }).click();
  await dialog
    .getByRole("button", { name: "기회가 되면", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "장소, 날짜, 사진과 더 자세한 기록" })
    .click();
  await dialog.getByLabel("어디에서 먹었나요?").fill("작은 식당");
  await dialog.getByLabel("지불한 가격").fill("12000");
  await dialog.getByLabel("태그").fill("혼밥, 여행");
  await dialog.locator("input[type=file]").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 2400;
        c.height = 1800;
        const x = c.getContext("2d")!;
        x.fillStyle = "#a7b094";
        x.fillRect(0, 0, 2400, 1800);
        return c.toDataURL("image/png").split(",")[1];
      }),
      "base64",
    ),
  });
  await expect(dialog.getByAltText("첨부 사진 1")).toBeVisible();
  await dialog
    .getByRole("button", { name: "기억 저장하기", exact: true })
    .click();
  await expect(page.locator(".record-row")).toHaveCount(2);
  let data = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!),
    KEY,
  );
  expect(data.menus).toHaveLength(1);
  expect(data.records).toHaveLength(2);
  expect(data.photos).toHaveLength(1);
  expect(data.photos[0].width).toBe(1600);
  expect(data.photos[0].height).toBe(1200);
  expect(data.photos[0].storage_path).toMatch(/^data:image\/webp;base64,/);
  await page.locator(".record-actions button").first().click();
  await page.getByRole("menuitem", { name: /기록 수정$/ }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("한 줄 기억").fill("수정한 기억");
  await dialog.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.getByText("수정한 기억", { exact: true })).toBeVisible();
  await page.locator(".record-actions > button").first().click();
  await page.getByRole("menuitem", { name: /기록 삭제$/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "기록 삭제", exact: true })
    .click();
  await expect(page.locator(".record-row")).toHaveCount(1);
  data = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), KEY);
  expect(data.menus).toHaveLength(1);
  expect(data.photos).toHaveLength(0);
  await page.getByRole("button", { name: "아카이브 설정과 백업" }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 백업" }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/palate-.*\.json/);
  await page
    .getByRole("dialog")
    .locator("input[type=file]")
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await page.getByRole("button", { name: "이 백업으로 복원" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".record-row")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("demo, navigation, search and narrow mobile viewport have no overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "예시 아카이브 둘러보기" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "예시 둘러보기" })
    .click();
  await expect(page.locator(".menu-tile")).toHaveCount(7);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "전체 검색", exact: true }).click();
  await page.getByLabel("전체 아카이브 검색").fill("커피");
  await expect(
    page.locator(".search-result-group").first().getByRole("link"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  for (const label of ["기록", "장소", "취향", "컬렉션"]) {
    await page
      .getByRole("navigation")
      .getByRole("link", { name: label })
      .click();
    await expect(page.locator("main h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "− 불호", exact: true }).click();
  await expect(page.locator(".menu-tile")).toHaveCount(1);
});
test("invalid import and full localStorage keep existing records", async ({
  page,
}) => {
  await page.goto("/");
  await create(page);
  const old = await page.evaluate((k) => localStorage.getItem(k), KEY);
  await page.getByRole("button", { name: "아카이브 설정과 백업" }).click();
  await page
    .getByRole("dialog")
    .locator("input[type=file]")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"schema_version":999}'),
    });
  await expect(page.getByRole("alert")).toContainText(
    "기존 기록은 그대로 유지",
  );
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(old);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "기록하기", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("메뉴 필수").fill("새로운 메뉴");
  await d.getByRole("button", { name: "+ 호", exact: true }).click();
  await d.getByRole("button", { name: "다시 먹는다", exact: true }).click();
  await d.getByRole("button", { name: "기억 저장하기", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "SAVE ERROR" })).toContainText(
    "저장 공간",
  );
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(old);
});
test("corrupt startup data stays untouched until a recovery decision", async ({
  page,
}) => {
  await page.addInitScript(
    (k) => localStorage.setItem(k, "broken original"),
    KEY,
  );
  await page.goto("/");
  await expect(
    page.getByRole("dialog", { name: "ARCHIVE RECOVERY" }),
  ).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(
    "broken original",
  );
});
test("cached app shell allows a new eating record offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "첫 식사 기록하기" }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await create(page, "오프라인 메뉴");
  await expect(
    page.getByRole("heading", { name: "오프라인 메뉴", exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
});
