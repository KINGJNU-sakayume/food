import { test, expect } from "@playwright/test";

const KEY = "palate.archive.v1";
test("manual P2 staging keeps the original archive, moves photos to Blob, and verifies after reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "첫 식사 기록하기" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("메뉴 필수").fill("P2 테스트 라멘");
  await dialog.getByRole("button", { name: "+ 호", exact: true }).click();
  await dialog.getByRole("button", { name: "다시 먹는다", exact: true }).click();
  await dialog.getByRole("button", { name: "장소, 날짜, 사진과 더 자세한 기록" }).click();
  await dialog.getByLabel("어디에서 먹었나요?").fill("검증용 식당");
  await dialog.locator("input[type=file]").setInputFiles({
    name: "one.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 48;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#d4b898";
        ctx.fillRect(0, 0, 64, 48);
        return canvas.toDataURL("image/png").split(",")[1];
      }),
      "base64",
    ),
  });
  await expect(dialog.getByAltText("첨부 사진 1")).toBeVisible();
  await dialog.getByRole("button", { name: "기억 저장하기" }).click();
  const original = await page.evaluate(key => localStorage.getItem(key), KEY);
  expect(original).toBeTruthy();
  const source = JSON.parse(original!);
  expect(source.photos).toHaveLength(1);

  await page.getByRole("button", { name: "아카이브 설정과 백업" }).click();
  await page.getByRole("button", { name: "IndexedDB 사본 생성 및 무결성 검사" }).click();
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: "사본 검증 성공" })).toBeVisible();
  const result = await page.evaluate(async () => {
    const request = indexedDB.open("palate-storage-stage-v1", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(["manifest","photos"], "readonly");
      const imageRequest = tx.objectStore("photos").getAll();
      const manifestRequest = tx.objectStore("manifest").get("candidate");
      const images: Array<{id: string; blob: Blob; mime: string}> = await new Promise((resolve, reject) => {
        imageRequest.onsuccess = () => resolve(imageRequest.result);
        imageRequest.onerror = () => reject(imageRequest.error);
      });
      const manifest = await new Promise<{archive: { photos: Array<{storage_path: string}> }}>((resolve, reject) => {
        manifestRequest.onsuccess = () => resolve(manifestRequest.result);
        manifestRequest.onerror = () => reject(manifestRequest.error);
      });
      return {
        count: images.length,
        actualBlob: images[0].blob instanceof Blob,
        size: images[0].blob.size,
        stagedPath: manifest.archive.photos[0].storage_path,
      };
    } finally {
      db.close();
    }
  });
  expect(result).toMatchObject({ count: 1, actualBlob: true, stagedPath: "" });
  expect(result.size).toBeGreaterThan(0);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(original);
  await page.reload();
  await page.getByRole("button", { name: "아카이브 설정과 백업" }).click();
  await page.getByRole("button", { name: "기존 사본만 다시 검증" }).click();
  await expect(page.getByRole("status").filter({ hasText: "사본 무결성 확인 완료" })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(original);
  expect(errors).toEqual([]);
});

test("staging cannot overwrite a damaged localStorage original", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "첫 식사 기록하기" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("메뉴 필수").fill("테스트");
  await dialog.getByRole("button", { name: "+ 호", exact: true }).click();
  await dialog.getByRole("button", { name: "다시 먹는다", exact: true }).click();
  await dialog.getByRole("button", { name: "기억 저장하기" }).click();
  await page.getByRole("button", { name: "아카이브 설정과 백업" }).click();
  await page.evaluate(key => localStorage.setItem(key, "{invalid json"), KEY);
  await page.getByRole("button", { name: "IndexedDB 사본 생성 및 무결성 검사" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe("{invalid json");
});
