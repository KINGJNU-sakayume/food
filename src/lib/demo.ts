import burger from "../assets/sample-burger.webp?url";
import coffee from "../assets/sample-coffee.webp?url";
import pizza from "../assets/sample-pizza.webp?url";
import { demoArchive, id } from "./data";
import { compressPhoto } from "./photos";
export async function loadDemo() {
  const a = demoArchive();
  for (const [name, url] of [
    ["싸이버거", burger],
    ["플랫 화이트", coffee],
    ["마르게리타", pizza],
  ]) {
    const menu = a.menus.find((m) => m.name === name)!;
    const record = a.records.find((r) => r.menu_id === menu.id)!;
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        "예시 사진을 불러오지 못했습니다. 연결 후 다시 시도해 주세요.",
      );
    const photo = await compressPhoto(
      new File([await response.blob()], "sample.webp", { type: "image/webp" }),
    );
    a.photos.push({
      id: id(),
      user_id: a.user.id,
      created_at: new Date().toISOString(),
      eating_record_id: record.id,
      sort_order: 0,
      ...photo,
    });
  }
  return a;
}
