import { test, expect } from "@playwright/test";

test("P3 local inbox: demo candidates stay pending until explicitly reviewed and approved", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/#/inbox");
  await expect(page.getByRole("heading", {name:"기록 후보함"})).toBeVisible();
  await page.getByRole("button",{name:"테스트 후보 2개 불러오기"}).click();
  await expect(page.locator(".hub-candidate-item")).toHaveCount(2);
  await expect(page.getByText("2개 대기")).toBeVisible();

  await page.locator(".hub-candidate-item").filter({hasText:"돈코츠 라멘"}).click();
  await page.getByRole("button",{name:"확인하고 실제 기록으로 저장"}).click();
  await expect(page.getByRole("alert")).toContainText("실제로 먹은 날짜");
  await page.getByLabel("후보 식사 날짜").fill("2026-11-01");
  await page.getByLabel("후보 재주문").selectOption("YES");
  await page.getByRole("button",{name:"확인하고 실제 기록으로 저장"}).click();
  await expect(page.getByText("1개 대기")).toBeVisible();
  await page.goto("/#/journal");
  await expect(page.locator(".p2-journal-entry")).toHaveCount(1);
  await expect(page.locator(".p2-journal-entry").first()).toContainText("돈코츠 라멘");

  await page.goto("/#/inbox");
  await page.getByRole("button",{name:"전체 기록"}).click();
  await page.locator(".hub-candidate-item").filter({hasText:"돈코츠 라멘"}).click();
  await expect(page.getByText("이미 실제 기록에 반영된 후보입니다.")).toBeVisible();
  await page.getByRole("button",{name:"대기 중"}).click();
  await page.locator(".hub-candidate-item").filter({hasText:"가보고 싶은 예시 식당"}).click();
  await page.getByLabel("후보 관심 주소").fill("서울 종로");
  await page.getByRole("button",{name:"확인하고 실제 기록으로 저장"}).click();
  await expect(page.getByText("0개 대기")).toBeVisible();
  await page.goto("/#/choose");
  await expect(page.getByText("가보고 싶은 예시 식당")).toBeVisible();
  await page.reload();
  await page.goto("/#/inbox");
  await page.getByRole("button",{name:"전체 기록"}).click();
  await expect(page.locator(".hub-candidate-item")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("P3 local inbox rejection never creates a meal and manual JSON isn't treated as authenticated",async ({page})=>{
  await page.goto("/#/inbox");
  await page.getByRole("button",{name:"테스트 후보 2개 불러오기"}).click();
  await page.locator(".hub-candidate-item").filter({hasText:"돈코츠 라멘"}).click();
  await page.getByRole("button",{name:"후보 거절"}).click();
  await expect(page.getByText("1개 대기")).toBeVisible();
  await page.goto("/#/journal");
  await expect(page.locator(".p2-journal-entry")).toHaveCount(0);

  await page.goto("/#/inbox");
  await page.getByRole("button",{name:"후보 JSON 직접 입력"}).click();
  await page.getByLabel("후보 JSON 입력").fill('{"candidate_type":"meal","status":"confirmed"}');
  await page.getByRole("button",{name:"검증 후 후보함에 추가"}).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await page.getByRole("button",{name:"전체 기록"}).click();
  await expect(page.locator(".hub-candidate-item")).toHaveCount(2);
});

test("P3 candidate approval after opt-in IndexedDB leaves legacy snapshot unchanged",async ({page})=>{
  await page.goto("/");
  await page.getByRole("button",{name:"첫 식사 기록하기"}).click();
  const form=page.getByRole("dialog");
  await form.getByLabel("메뉴 필수").fill("원본 식사");
  await form.getByRole("button",{name:"+ 호",exact:true}).click();
  await form.getByRole("button",{name:"다시 먹는다",exact:true}).click();
  await form.getByRole("button",{name:"기억 저장하기"}).click();
  await page.getByRole("button",{name:"아카이브 설정과 백업"}).click();
  await page.getByRole("button",{name:"IndexedDB 사본 생성 및 무결성 검사"}).click();
  await expect(page.getByText("사본 검증 성공")).toBeVisible();
  await page.getByText("별도 JSON 백업을 보관했고").click();
  await page.getByRole("button",{name:"검증된 사본으로 기본 저장소 전환"}).click();
  await expect(page.getByText(/이 브라우저는 IndexedDB에 식사 데이터와 사진을 저장합니다/)).toBeVisible();
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  const raw = await page.evaluate(()=>localStorage.getItem("palate.archive.v1"));
  await page.goto("/#/inbox");
  await page.getByRole("button",{name:"테스트 후보 2개 불러오기"}).click();
  await page.locator(".hub-candidate-item").filter({hasText:"돈코츠 라멘"}).click();
  await page.getByLabel("후보 식사 날짜").fill("2026-11-01");
  await page.getByLabel("후보 재주문").selectOption("MAYBE");
  await page.getByRole("button",{name:"확인하고 실제 기록으로 저장"}).click();
  await expect(page.getByText("1개 대기")).toBeVisible();
  await page.reload();
  await page.goto("/#/journal");
  await expect(page.locator(".p2-journal-entry")).toHaveCount(2);
  expect(await page.evaluate(()=>localStorage.getItem("palate.archive.v1"))).toBe(raw);
});
