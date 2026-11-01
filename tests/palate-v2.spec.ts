import { test, expect } from "@playwright/test";

test("v2 keeps the same menu separate by place and connects journal, timeline, and choosing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", err => errors.push(err.message));
  await page.goto("/");
  await page.getByRole("button", { name: "첫 식사 기록하기" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("메뉴 필수").fill("돈코츠 라멘");
  await dialog.getByRole("button", { name: "+ 호", exact: true }).click();
  await dialog.getByRole("button", { name: "다시 먹는다", exact: true }).click();
  await dialog.getByLabel("한 줄 기억").fill("진한 국물이 좋았다");
  await dialog.getByRole("button", { name: "장소, 날짜, 사진과 더 자세한 기록" }).click();
  await dialog.getByLabel("어디에서 먹었나요?").fill("멘야하나 성수");
  await dialog.getByLabel("주소 또는 동네").fill("서울 성수");
  await dialog.getByRole("button", { name: "기억 저장하기" }).click();
  await expect(page.locator(".p2-card")).toHaveCount(1);
  await expect(page.locator(".p2-card").first()).toContainText("멘야하나 성수");
  await page.locator(".p2-card").first().click();
  await expect(page.locator(".p2-timeline-item")).toHaveCount(1);
  await page.getByRole("button", { name: "다시 먹은 기록" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "= 보통", exact: true }).click();
  await dialog.getByRole("button", { name: "다시 먹는다", exact: true }).click();
  await dialog.getByRole("button", { name: "장소, 날짜, 사진과 더 자세한 기록" }).click();
  await dialog.getByLabel("어디에서 먹었나요?").fill("하루멘 홍대");
  await dialog.getByLabel("주소 또는 동네").fill("서울 홍대");
  await dialog.getByLabel("한 줄 기억").fill("이번엔 평범했다");
  await dialog.getByRole("button", { name: "기억 저장하기" }).click();
  await page.goto("/#/collection");
  await expect(page.locator(".p2-card")).toHaveCount(2);
  await expect(page.locator(".p2-card").filter({ hasText: "하루멘 홍대" })).toHaveCount(1);
  await expect(page.locator(".p2-card").filter({ hasText: "멘야하나 성수" })).toHaveCount(1);
  await page.locator(".p2-card").filter({ hasText: "하루멘 홍대" }).click();
  await expect(page.locator(".p2-timeline-item")).toHaveCount(1);
  await page.locator(".p2-timeline-item").first().click();
  await expect(page.locator(".p2-meal-detail")).toContainText("이번엔 평범했다");
  await page.goto("/#/journal");
  await expect(page.locator(".p2-journal-entry")).toHaveCount(2);
  await expect(page.locator(".p2-journal-cover")).toHaveCount(0); // no invented meal photos
  await page.goto("/#/choose");
  await expect(page.getByRole("heading", { name: "오늘, 뭐 먹지?" })).toBeVisible();
  await expect(page.locator(".p2-compare-candidate")).toHaveCount(2);
  await page.locator(".p2-compare-candidate > button").first().click();
  await page.locator(".p2-compare-candidate > button").last().click();
  await expect(page.locator(".p2-compare-grid a")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("v2 mobile views keep controls within a narrow screen", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 780 });
    for (const route of ["/#/collection", "/#/journal", "/#/choose"]) {
      await page.goto(route);
      await expect(page.locator("main h1")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
