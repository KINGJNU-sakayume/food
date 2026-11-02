import { test, expect } from "@playwright/test";

const HUB = "https://life-hub-api.213303.workers.dev";
const KEY = "claude:mcp-" + "b".repeat(40);
const candidate = {
  schema_version: 1, source: "claude", source_ref: "claude-mcp:2026-11-02", idempotency_key: "mcp-" + "b".repeat(40),
  created_at: "2026-11-02T01:18:24.172Z", candidate_type: "meal",
  payload: { menu_name: "가상 까르보 컵라면", eaten_at: "2026-11-02", note: "브런치" },
};

test("not connected: the connect button is shown but only works on the deployed address", async ({ page }) => {
  await page.goto("/#/inbox");
  await expect(page.getByText("Life Hub에 연결되어 있지 않아요")).toBeVisible();
  await expect(page.getByRole("button", { name: "Life Hub 연결" })).toBeDisabled();
  await expect(page.getByText("배포된 PALATE 주소에서만 연결할 수 있어요.")).toBeVisible();
});

test("connected: opening the inbox pulls Life Hub candidates, approval sends a receipt", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const receipts: Array<Record<string, string>> = [];
  let pending = true;
  await page.route(HUB + "/**", async (route) => {
    const url = new URL(route.request().url());
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Content-Type": "application/json" };
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
  await page.addInitScript(() => {
    localStorage.setItem("palate.lifehub.remote.v1", JSON.stringify({
      access_token: "at-synthetic", refresh_token: "rt-synthetic", access_expires_at: Date.now() + 3_600_000, connected_at: "2026-11-02T00:00:00.000Z",
    }));
  });

  await page.goto("/#/inbox");
  await expect(page.getByText("Life Hub에 연결됨")).toBeVisible();
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
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Content-Type": "application/json" };
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
  await page.addInitScript(() => {
    localStorage.setItem("palate.lifehub.remote.v1", JSON.stringify({
      access_token: "at-synthetic", refresh_token: "rt-synthetic", access_expires_at: Date.now() + 3_600_000, connected_at: "2026-11-02T00:00:00.000Z",
    }));
  });
  // First visit: the inbox saves this device's archive; nothing to review yet.
  await page.goto("/#/inbox");
  await expect(page.getByText("Life Hub에 연결됨")).toBeVisible();
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
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Content-Type": "application/json" };
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
  const toggle = page.getByLabel("Claude에서 승인된 항목 자동 반영");
  await expect(toggle).not.toBeChecked();
  const item = page.locator(".hub-candidate-item").filter({ hasText: "가상 대기 덮밥" });
  await expect(item).toContainText("Claude에서 승인함");
  await page.goto("/#/journal");
  await expect(page.locator(".p2-journal-entry")).toHaveCount(0);
});
