import { test, expect } from "@playwright/test";

const KEY = "palate.archive.v1";
async function addMeal(page: import("@playwright/test").Page, name: string, withImage = false) {
  await page.getByRole("button", { name: "기록하기", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("메뉴 필수").fill(name);
  await dialog.getByRole("button", { name: "+ 호", exact: true }).click();
  await dialog.getByRole("button", { name: "다시 먹는다", exact: true }).click();
  if (withImage) {
    await dialog.getByRole("button", { name: "장소, 날짜, 사진과 더 자세한 기록" }).click();
    const buffer = Buffer.from(await page.evaluate(() => {
      const c = document.createElement("canvas"); c.width = 50; c.height = 40;
      const context = c.getContext("2d")!;
      context.fillStyle = "#b0a07c"; context.fillRect(0, 0, c.width, c.height);
      return c.toDataURL("image/png").split(",")[1];
    }), "base64");
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "meal.png", mimeType: "image/png", buffer,
    });
    await expect(dialog.getByAltText("첨부 사진 1")).toBeVisible();
  }
  await dialog.getByRole("button", { name: "기억 저장하기" }).click();
  await expect(dialog).toHaveCount(0);
}
async function activate(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "아카이브 설정과 백업" }).click();
  await page.getByRole("button", { name: "IndexedDB 사본 생성 및 무결성 검사" }).click();
  await expect(page.getByText("사본 검증 성공")).toBeVisible();
  await page.getByText("별도 JSON 백업을 보관했고").click();
  await page.getByRole("button", { name: "검증된 사본으로 기본 저장소 전환" }).click();
  await expect(page.getByText("이 브라우저는 IndexedDB에 식사 데이터와 사진을 저장합니다.")).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
}

test("P2-B opt-in primary uses blobs and preserves legacy JSON exactly after writes and reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", err => errors.push(err.message));
  await page.goto("/");
  await addMeal(page, "전환 전 파스타", true);
  const raw = await page.evaluate(key => localStorage.getItem(key), KEY);
  const source = JSON.parse(raw!);
  expect(source.photos).toHaveLength(1);
  await activate(page);
  expect(await page.evaluate(() => localStorage.getItem("palate.storage.primary.v1"))).toBe("on");
  const primary = await page.evaluate(async () => {
    const req = indexedDB.open("palate-storage-primary-v1");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
    try {
      const tx = db.transaction(["manifest", "photos"], "readonly");
      const imageRequest = tx.objectStore("photos").getAll();
      const manifestRequest = tx.objectStore("manifest").get("active");
      const photos: { blob: Blob }[] = await new Promise((res, rej) => {
        imageRequest.onsuccess = () => res(imageRequest.result); imageRequest.onerror = () => rej(imageRequest.error);
      });
      const manifest: { archive: {photos: {storage_path: string}[]}, revision: number } =
        await new Promise((res, rej) => {
          manifestRequest.onsuccess = () => res(manifestRequest.result);
          manifestRequest.onerror = () => rej(manifestRequest.error);
        });
      return { blob: photos[0].blob instanceof Blob, count: photos.length, path: manifest.archive.photos[0].storage_path, revision: manifest.revision };
    } finally { db.close(); }
  });
  expect(primary).toMatchObject({blob:true, count:1, path:"", revision:1});
  await addMeal(page, "전환 후 라멘");
  await expect(page.locator(".p2-card")).toHaveCount(2);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(raw);
  await page.reload();
  await expect(page.locator(".p2-card")).toHaveCount(2);
  await expect(page.locator(".p2-card").filter({hasText:"전환 후 라멘"})).toHaveCount(1);
  await page.getByRole("button", { name: "아카이브 설정과 백업" }).click();
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 백업" }).click();
  const file = await wait;
  const stream = await file.createReadStream();
  const buffers: Buffer[] = [];
  for await (const chunk of stream) buffers.push(Buffer.from(chunk));
  const backup = JSON.parse(Buffer.concat(buffers).toString("utf8"));
  expect(backup.records).toHaveLength(2);
  expect(backup.photos).toHaveLength(1);
  expect(backup.photos[0].storage_path).toMatch(/^data:image\/webp;base64,/);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(raw);
  expect(errors).toEqual([]);
});
test("P2-B notices changed frozen legacy source and blocks subsequent writes", async ({ page }) => {
  await page.goto("/");
  await addMeal(page, "첫 메뉴");
  await activate(page);
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ invalid: true })), KEY);
  await page.reload();
  await expect(page.getByText(/IndexedDB 읽기·무결성 검사 실패/)).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toContain("invalid");
});

test("P2-B syncs changes between active tabs without rewriting legacy storage", async ({ page, context }) => {
  await page.goto("/");
  await addMeal(page, "초기 메뉴");
  const frozen = await page.evaluate(key => localStorage.getItem(key), KEY);
  await activate(page);
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.locator(".p2-card")).toHaveCount(1);
  await addMeal(other, "다른 탭에서 추가한 메뉴");
  await expect(page.locator(".p2-card")).toHaveCount(2);
  await expect(page.locator(".p2-card").filter({ hasText: "다른 탭에서 추가한 메뉴" })).toHaveCount(1);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(frozen);
  await other.close();
});

test("P2-B deletes edited photo blobs from active storage but keeps original rollback JSON", async ({ page }) => {
  await page.goto("/");
  await addMeal(page, "사진 수정용 국수");
  await activate(page);
  await addMeal(page, "사진 있는 덮밥", true);
  await page.goto("/#/journal");
  await page.locator(".p2-journal-entry").filter({hasText:"사진 있는 덮밥"}).getByRole("link").click();
  await page.getByRole("button", { name: "기록 수정" }).click();
  const edit = page.getByRole("dialog");
  await edit.getByRole("button", { name: "사진 1 제거" }).click();
  await edit.getByRole("button", { name: "변경 저장" }).click();
  await expect(edit).toHaveCount(0);
  await page.reload();
  await page.goto("/#/journal");
  await expect(page.locator(".p2-journal-cover")).toHaveCount(0);
  const photoCount = await page.evaluate(async () => {
    const req = indexedDB.open("palate-storage-primary-v1");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    try {
      const tx = db.transaction("photos", "readonly");
      const count = tx.objectStore("photos").count();
      return await new Promise<number>((resolve,reject) => {
        count.onsuccess = () => resolve(count.result); count.onerror = () => reject(count.error);
      });
    } finally { db.close(); }
  });
  expect(photoCount).toBe(0);
});

test("P2-B simultaneous writes from two tabs do not silently discard either meal", async ({ page, context }) => {
  await page.goto("/");
  await addMeal(page, "동시성 검증 초기 메뉴");
  await activate(page);
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.locator(".p2-card")).toHaveCount(1);
  await Promise.all([
    addMeal(page, "동시에 추가한 메뉴 A"),
    addMeal(second, "동시에 추가한 메뉴 B"),
  ]);
  await expect(page.locator(".p2-card")).toHaveCount(3);
  await page.reload();
  await expect(page.locator(".p2-card").filter({hasText:"동시에 추가한 메뉴 A"})).toHaveCount(1);
  await expect(page.locator(".p2-card").filter({hasText:"동시에 추가한 메뉴 B"})).toHaveCount(1);
  await second.close();
});


test("P2-B exports the latest verified IDB copy when frozen legacy is malformed, then restores safely", async ({ page }) => {
  await page.goto("/");
  await addMeal(page, "복구 기준 식사");
  await activate(page);
  await addMeal(page, "IDB에만 있는 최신 식사");
  const oldPrimaryMode = await page.evaluate(() => localStorage.getItem("palate.storage.primary.v1"));
  expect(oldPrimaryMode).toBe("on");
  const damaged = "{legacy-corrupt";
  await page.evaluate(({ key, bad }) => localStorage.setItem(key, bad), { key: KEY, bad: damaged });
  await page.reload();
  const recovery = page.getByRole("dialog");
  await expect(recovery.getByText(/IndexedDB 읽기·무결성 검사 실패/)).toBeVisible();

  const downloadEvent = page.waitForEvent("download");
  await recovery.getByRole("button", { name: /검증된 최신 IndexedDB 기록 내보내기/ }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk));
  const json = Buffer.concat(parts);
  const archive = JSON.parse(json.toString("utf8"));
  expect(archive.records).toHaveLength(2);
  expect(archive.menus.some((m: {name:string}) => m.name === "IDB에만 있는 최신 식사")).toBe(true);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(damaged);

  await recovery.getByLabel("정상 JSON 백업 선택").setInputFiles({
    name: "palate-rescued.json", mimeType: "application/json", buffer: json,
  });
  await expect(recovery.getByText(/선택한 백업/)).toBeVisible();
  await recovery.getByLabel(/기존 기록과 원본을 따로 보관했고/).check();
  await recovery.getByRole("button", { name: /새 저장소에 복구/ }).click();
  await expect(recovery).toHaveCount(0);
  await expect(page.locator(".p2-card")).toHaveCount(2);
  const newMode = await page.evaluate(() => localStorage.getItem("palate.storage.primary.v1"));
  expect(newMode).toMatch(/^db:palate-storage-recovered-/);
  expect(newMode).not.toBe(oldPrimaryMode);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(damaged);
  await page.reload();
  await expect(page.locator(".p2-card")).toHaveCount(2);
  await addMeal(page, "복구 이후 새로운 기록");
  await expect(page.locator(".p2-card")).toHaveCount(3);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(damaged);
});

test("P2-B restores a portable JSON without overwriting an invalid primary database", async ({ page }) => {
  await page.goto("/");
  await addMeal(page, "복구할 식사");
  const rollback = await page.evaluate(key => localStorage.getItem(key), KEY);
  expect(rollback).toBeTruthy();
  await activate(page);
  await page.evaluate(async () => {
    const req = indexedDB.open("palate-storage-primary-v1", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const tx = db.transaction("manifest", "readwrite");
      const store = tx.objectStore("manifest");
      const existing = store.get("active");
      existing.onsuccess = () => {
        const entry = existing.result;
        entry.digest = "invalid-checksum";
        store.put(entry);
      };
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
  await page.reload();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/IndexedDB 읽기·무결성 검사 실패/)).toBeVisible();
  const errorButton = dialog.getByRole("button", { name: /검증된 최신 IndexedDB 기록 내보내기/ });
  await errorButton.click();
  await expect(dialog.getByText(/검증된 IndexedDB 백업을 만들지 못했습니다/)).toBeVisible();
  await dialog.getByLabel("정상 JSON 백업 선택").setInputFiles({
    name: "rollback.json", mimeType: "application/json", buffer: Buffer.from(rollback!),
  });
  await dialog.getByLabel(/기존 기록과 원본을 따로 보관했고/).check();
  await dialog.getByRole("button", { name: /새 저장소에 복구/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".p2-card")).toHaveCount(1);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(rollback);
  const unchangedOldDigest = await page.evaluate(async () => {
    const req = indexedDB.open("palate-storage-primary-v1", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const tx = db.transaction("manifest", "readonly");
      const get = tx.objectStore("manifest").get("active");
      return await new Promise<string>((resolve, reject) => {
        get.onsuccess = () => resolve(get.result.digest);
        get.onerror = () => reject(get.error);
      });
    } finally { db.close(); }
  });
  expect(unchangedOldDigest).toBe("invalid-checksum");
  await page.reload();
  await expect(page.locator(".p2-card")).toHaveCount(1);
});
