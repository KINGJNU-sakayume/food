import { test, expect } from "@playwright/test";

const HUB = "https://life-hub-api.213303.workers.dev";
const KEY = "claude:mcp-" + "b".repeat(40);
const candidate = {
  schema_version: 1, source: "claude", source_ref: "claude-mcp:2026-11-02", idempotency_key: "mcp-" + "b".repeat(40),
  created_at: "2026-11-02T01:18:24.172Z", candidate_type: "meal",
  payload: { menu_name: "가상 까르보 컵라면", eaten_at: "2026-11-02", note: "브런치" },
};

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Content-Type": "application/json" };
const connectedTokens = () => {
  localStorage.setItem("palate.lifehub.remote.v1", JSON.stringify({
    access_token: "at-synthetic", refresh_token: "rt-synthetic", access_expires_at: Date.now() + 3_600_000, connected_at: "2026-11-02T00:00:00.000Z",
  }));
};
const lifeHubSection = (page: import("@playwright/test").Page) => page.getByRole("dialog").locator("#settings-lifehub");

test("not connected: only the settings' Life Hub section has the connect button (deployed address only)", async ({ page }) => {
  await page.goto("/#/inbox");
  await expect(page.getByRole("heading", { name: "기록 후보함" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Life Hub 연결" })).toHaveCount(0);
  await expect(page.getByText(/Life Hub에 연결/)).toHaveCount(0);

  await page.goto("/#/collection");
  await expect(page.getByRole("button", { name: "Life Hub 연결" })).toHaveCount(0);
  await page.getByRole("button", { name: "아카이브 설정과 백업" }).click();
  const section = lifeHubSection(page);
  await expect(section.getByRole("heading", { name: "Life Hub", exact: true })).toBeVisible();
  await expect(section.getByText("Claude가 제안한 기록을 받습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Life Hub 연결" })).toHaveCount(1);
  await expect(section.getByRole("button", { name: "Life Hub 연결" })).toBeDisabled();
  await expect(section.getByText("배포된 주소에서만 연결할 수 있어요.")).toBeVisible();
  // The section sits right above 「내 기록 가져가기」.
  const order = await page.locator(".settings h3").allTextContents();
  expect(order.indexOf("내 기록 가져가기") - order.indexOf("Life Hub")).toBe(1);
});

test("no candidates: the header inbox entry is not rendered; a bookmark shows the empty state", async ({ page }) => {
  let asked = 0;
  await page.route(HUB + "/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (new URL(route.request().url()).pathname === "/palate/v1/candidates") {
      asked++;
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: [] }) });
    }
    return route.fulfill({ status: 404, headers: cors, body: "{}" });
  });
  await page.addInitScript(connectedTokens);
  await page.goto("/#/inbox");
  await expect.poll(() => asked).toBe(1);
  await expect(page.getByText("검토할 후보가 없습니다.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Life Hub 기록 후보함/ })).toHaveCount(0);
  await page.getByRole("link", { name: "컬렉션으로" }).click();
  await expect(page).toHaveURL(/#\/collection$/);
  await expect(page.getByRole("link", { name: /Life Hub 기록 후보함/ })).toHaveCount(0);

  // State B: 「지금 동기화」 runs the same round trip; the result is the status line only.
  await page.getByRole("button", { name: "아카이브 설정과 백업" }).click();
  const section = lifeHubSection(page);
  await expect(section.getByText("연결됨", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "지금 동기화" }).click();
  await expect.poll(() => asked).toBe(2);
  await expect(section.getByText("연결됨", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Life Hub 연결" })).toHaveCount(0);
});

test("state C: a refused token puts a dot on the settings entry and a reconnect box in the section", async ({ page }) => {
  await page.route(HUB + "/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === "/oauth/token") return route.fulfill({ status: 400, headers: cors, body: JSON.stringify({ error: "invalid_grant" }) });
    if (url.pathname === "/palate/v1/candidates") return route.fulfill({ status: 401, headers: cors, body: "{}" });
    return route.fulfill({ status: 404, headers: cors, body: "{}" });
  });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("palate.lifehub.remote.v1", JSON.stringify({
        access_token: "at-synthetic", refresh_token: "rt-synthetic", access_expires_at: Date.now() + 3_600_000, connected_at: "2026-11-02T00:00:00.000Z",
      }));
    }
  });
  await page.goto("/#/inbox");
  const gear = page.getByRole("button", { name: "아카이브 설정과 백업 (확인 필요)" });
  await expect(gear).toBeVisible();
  await expect(gear.locator(".hub-alert-dot")).toBeVisible();
  const box = await gear.locator(".hub-alert-dot").boundingBox();
  expect(box?.width).toBe(8);

  // Still there after a reload.
  await page.reload();
  await expect(page.getByRole("button", { name: "아카이브 설정과 백업 (확인 필요)" })).toBeVisible();
  await page.getByRole("button", { name: "아카이브 설정과 백업 (확인 필요)" }).click();
  const section = lifeHubSection(page);
  await expect(section.getByText("확인 필요", { exact: true })).toBeVisible();
  await expect(section.getByText("Life Hub 연결이 끊겼습니다. 다시 연결해 주세요. 이 기기의 기록은 그대로입니다.")).toBeVisible();
  await expect(section.getByRole("button", { name: "다시 연결" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await section.getByRole("button", { name: "연결 해제" }).click();
  await expect(section.getByRole("button", { name: "Life Hub 연결" })).toBeVisible();
  await expect(page.getByRole("button", { name: "아카이브 설정과 백업", exact: true })).toBeVisible();
  await expect(page.locator(".hub-alert-dot")).toHaveCount(0);
});

test("connected: opening the inbox pulls Life Hub candidates, approval sends a receipt", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const receipts: Array<Record<string, string>> = [];
  let pending = true;
  await page.route(HUB + "/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    expect(route.request().headers()["authorization"]).toBe("Bearer at-synthetic");
    if (url.pathname === "/palate/v1/candidates")
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: pending ? [{ key: KEY, status: "pending", candidate }] : [] }) });
    if (url.pathname === "/palate/v1/receipts") {
      receipts.push(JSON.parse(route.request().postData() || "{}"));
      pending = false;
      return route.fulfill({ status: 200, headers: cors, body: "{}" });
    }
    return route.fulfill({ status: 404, headers: cors, body: "{}" });
  });
  await page.addInitScript(connectedTokens);

  await page.goto("/#/inbox");
  const inboxLink = page.getByRole("link", { name: "Life Hub 기록 후보함 (대기 1건)" });
  await expect(inboxLink).toBeVisible();
  await expect(inboxLink.locator(".hub-count-badge")).toHaveText("1");
  const item = page.locator(".hub-candidate-item").filter({ hasText: "가상 까르보 컵라면" });
  await expect(item).toBeVisible();
  await expect(item).toContainText("claude · Life Hub");
  await expect(page.getByText("1개 대기")).toBeVisible();

  // Nothing is recorded until the owner approves.
  await page.goto("/#/journal");
  await expect(page.locator(".p2-journal-entry")).toHaveCount(0);
  await page.goto("/#/inbox");

  await page.locator(".hub-candidate-item").filter({ hasText: "가상 까르보 컵라면" }).click();
  await expect(page.getByLabel("후보 식사 날짜")).toHaveValue("2026-11-02");
  await page.getByLabel("후보 호불호").selectOption("LIKE");
  await page.getByLabel("후보 재주문").selectOption("MAYBE");
  await page.getByRole("button", { name: "확인하고 실제 기록으로 저장" }).click();
  await expect(page.getByText("0개 대기")).toBeVisible();
  await expect(page.getByText("검토할 후보가 없습니다.")).toBeVisible();
  await expect(page.getByRole("link", { name: "컬렉션으로" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Life Hub 기록 후보함/ })).toHaveCount(0);
  await expect.poll(() => receipts.length).toBe(1);
  expect(receipts[0].key).toBe(KEY);
  expect(receipts[0].entity_type).toBe("meal");
  expect(receipts[0].entity_id).toMatch(/^[0-9a-f-]{36}$/);

  await page.goto("/#/journal");
  await expect(page.locator(".p2-journal-entry").first()).toContainText("가상 까르보 컵라면");
  expect(errors).toEqual([]);
});

test("opening the app saves what the owner approved in a Claude card and sends the receipt", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const receipts: Array<Record<string, string>> = [];
  const asked: string[] = [];
  let approvedInCard = false;
  const edited = { ...candidate, payload: { menu_name: "가상 카드 수정 덮밥", eaten_at: "2026-11-02", verdict: "LIKE", reorder_intent: "YES" } };
  await page.route(HUB + "/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === "/palate/v1/candidates") {
      asked.push(url.searchParams.get("status") || "");
      const list = receipts.length || !approvedInCard ? [] : [{ key: KEY, status: "approved", candidate, revision: 1, final_candidate: edited, needs_app_review: false }];
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: list }) });
    }
    if (url.pathname === "/palate/v1/receipts") {
      receipts.push(JSON.parse(route.request().postData() || "{}"));
      return route.fulfill({ status: 200, headers: cors, body: "{}" });
    }
    return route.fulfill({ status: 404, headers: cors, body: "{}" });
  });
  await page.addInitScript(connectedTokens);
  // First visit: the inbox saves this device's archive; nothing to review yet.
  await page.goto("/#/inbox");
  await expect(page.getByText("검토할 후보가 없습니다.")).toBeVisible();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe("open");
  // The owner approves in Claude; the next time PALATE opens (any page) it is saved without asking.
  approvedInCard = true;
  await page.goto("/#/collection");
  await page.reload();
  await expect.poll(() => receipts.length).toBe(1);
  await expect(page.getByText("Claude에서 승인한 기록 1개를 PALATE에 저장했어요.")).toBeVisible();
  expect(receipts[0].key).toBe(KEY);
  expect(receipts[0].entity_type).toBe("meal");

  await page.goto("/#/journal");
  await expect(page.locator(".p2-journal-entry").first()).toContainText("가상 카드 수정 덮밥");
  await expect(page.locator(".p2-journal-entry")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("the auto-apply setting can be turned off, and then the approved item waits in the inbox", async ({ page }) => {
  const edited = { ...candidate, payload: { menu_name: "가상 대기 덮밥", eaten_at: "2026-11-02", verdict: "LIKE", reorder_intent: "YES" } };
  await page.route(HUB + "/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === "/palate/v1/candidates")
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: [{ key: KEY, status: "approved", candidate, revision: 1, final_candidate: edited, needs_app_review: false }] }) });
    return route.fulfill({ status: 404, headers: cors, body: "{}" });
  });
  await page.addInitScript(() => {
    localStorage.setItem("palate.lifehub.remote.v1", JSON.stringify({
      access_token: "at-synthetic", refresh_token: "rt-synthetic", access_expires_at: Date.now() + 3_600_000, connected_at: "2026-11-02T00:00:00.000Z",
    }));
    localStorage.setItem("palate.lifehub.auto-apply.v1", "off");
  });
  await page.goto("/#/inbox");
  await expect(page.getByRole("link", { name: "Life Hub 기록 후보함 (대기 1건)" })).toBeVisible();
  await page.getByRole("button", { name: "아카이브 설정과 백업" }).click();
  const toggle = lifeHubSection(page).getByLabel("Claude에서 승인한 기록은 바로 반영");
  await expect(toggle).not.toBeChecked();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  const item = page.locator(".hub-candidate-item").filter({ hasText: "가상 대기 덮밥" });
  await expect(item).toContainText("Claude에서 승인함");
  await page.goto("/#/journal");
  await expect(page.locator(".p2-journal-entry")).toHaveCount(0);
});
