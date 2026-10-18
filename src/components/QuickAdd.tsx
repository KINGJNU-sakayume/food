import { useState } from "react";
import { Plus, Check, ChevronDown, ImagePlus, X } from "lucide-react";
import type {
  Archive,
  Context,
  EatingRecord,
  RecordDraft,
  Reorder,
  Verdict,
} from "../types/model";
import {
  menuRecords,
  normalize,
  reorders,
  saveRecord,
  today,
  verdicts,
} from "../lib/data";
import { compressPhoto } from "../lib/photos";
import { Modal } from "./Common";
export default function QuickAdd({
  archive,
  onClose,
  onSave,
  record,
  initialMenuId,
}: {
  archive: Archive;
  onClose: () => void;
  onSave: (fn: (a: Archive) => Archive) => boolean;
  record?: EatingRecord;
  initialMenuId?: string;
}) {
  const initialMenu = archive.menus.find(
      (m) => m.id === (record?.menu_id || initialMenuId),
    ),
    place = archive.places.find((p) => p.id === record?.place_id);
  const [draft, setDraft] = useState<RecordDraft>({
    menu_name: initialMenu?.name || "",
    menu_id: initialMenu?.id,
    brand_name:
      archive.brands.find((b) => b.id === initialMenu?.brand_id)?.name || "",
    place_name: place?.name || "",
    address: place?.address || "",
    category: initialMenu?.category || "",
    verdict: record?.verdict as Verdict,
    reorder_intent: record?.reorder_intent as Reorder,
    short_note: record?.short_note || "",
    detailed_note: record?.detailed_note || "",
    eaten_at: record?.eaten_at || today(),
    price_paid: record?.price_paid,
    dining_context: record?.dining_context || "DINE_IN",
    tags: archive.record_tags
      .filter((t) => t.eating_record_id === record?.id)
      .map((t) => archive.tags.find((x) => x.id === t.tag_id)?.name || ""),
    photos: archive.photos
      .filter((p) => p.eating_record_id === record?.id)
      .sort((a, b) => a.sort_order - b.sort_order),
  });
  const [expanded, setExpanded] = useState(!!record),
    [suggest, setSuggest] = useState(false),
    [error, setError] = useState(""),
    [processing, setProcessing] = useState(false);
  const update = <K extends keyof RecordDraft>(key: K, value: RecordDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const candidates = archive.menus
    .filter(
      (m) =>
        normalize(m.name).includes(normalize(draft.menu_name)) ||
        normalize(
          archive.brands.find((b) => b.id === m.brand_id)?.name || "",
        ).includes(normalize(draft.menu_name)),
    )
    .slice(0, 5);
  const similar =
    !draft.menu_id &&
    !draft.force_new_menu &&
    archive.menus.find(
      (m) =>
        m.normalized_name === normalize(draft.menu_name) &&
        m.brand_id ===
          archive.brands.find(
            (b) => normalize(b.name) === normalize(draft.brand_name),
          )?.id,
    );
  const selectMenu = (menuId: string) => {
    const m = archive.menus.find((m) => m.id === menuId)!;
    setDraft((d) => ({
      ...d,
      menu_id: m.id,
      menu_name: m.name,
      brand_name: archive.brands.find((b) => b.id === m.brand_id)?.name || "",
      category: m.category || "",
      force_new_menu: false,
    }));
    setSuggest(false);
  };
  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setError("");
    if (draft.photos.length + files.length > 6) {
      setError("한 식사에 사진을 6장까지 첨부할 수 있습니다.");
      return;
    }
    setProcessing(true);
    try {
      const photos: RecordDraft["photos"] = [];
      for (const file of Array.from(files))
        photos.push(await compressPhoto(file));
      setDraft((d) => ({ ...d, photos: [...d.photos, ...photos] }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }
  return (
    <Modal title={record ? "EDIT RECORD" : "NEW RECORD"} onClose={onClose}>
      <form
        className="quick-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.verdict || !draft.reorder_intent) {
            setError("호·불호와 재주문 의사를 선택해 주세요.");
            return;
          }
          if (processing) return;
          if (onSave((a) => saveRecord(a, draft, record?.id))) onClose();
        }}
      >
        <h2>{record ? "그날의 기록을 고치다." : "무엇을 먹었나요?"}</h2>
        <p className="muted">한 끼의 기억이 나의 취향이 됩니다.</p>
        <label className="field">
          <span>
            메뉴 <small>필수</small>
          </span>
          <input
            autoFocus
            required
            maxLength={200}
            placeholder="메뉴 이름으로 찾거나 직접 추가"
            value={draft.menu_name}
            onFocus={() => setSuggest(true)}
            onChange={(e) => {
              setDraft((d) => ({
                ...d,
                menu_name: e.target.value,
                menu_id: undefined,
                force_new_menu: false,
              }));
              setSuggest(true);
            }}
            autoComplete="off"
          />
        </label>
        {suggest && archive.menus.length > 0 && (
          <div className="suggestions">
            <div className="eyebrow">
              {draft.menu_name ? "기존 메뉴" : "최근 메뉴"}
            </div>
            {candidates.map((m) => (
              <button type="button" key={m.id} onClick={() => selectMenu(m.id)}>
                <span>
                  {m.name}
                  <small>
                    {archive.brands.find((b) => b.id === m.brand_id)?.name ||
                      m.category}
                  </small>
                </span>
                <span className="muted">
                  {menuRecords(archive, m.id).length}회
                </span>
              </button>
            ))}
            {draft.menu_name && (
              <button type="button" onClick={() => setSuggest(false)}>
                <Plus size={16} />
                <span>“{draft.menu_name}” 직접 추가</span>
              </button>
            )}
            {!candidates.length && !draft.menu_name && (
              <p>등록한 메뉴가 없습니다.</p>
            )}
          </div>
        )}
        <div className="field">
          <span>
            어땠나요? <small>필수</small>
          </span>
          <div className="choice-group verdict-choices">
            {(Object.keys(verdicts) as Verdict[]).map((v) => (
              <button
                type="button"
                className={draft.verdict === v ? "selected" : ""}
                aria-pressed={draft.verdict === v}
                key={v}
                onClick={() => {
                  update("verdict", v);
                  setSuggest(false);
                }}
              >
                <b>{verdicts[v].mark}</b>
                {verdicts[v].label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>
            또 먹고 싶은가요? <small>필수</small>
          </span>
          <div className="choice-group">
            {(Object.keys(reorders) as Reorder[]).map((v) => (
              <button
                type="button"
                className={draft.reorder_intent === v ? "selected" : ""}
                aria-pressed={draft.reorder_intent === v}
                key={v}
                onClick={() => update("reorder_intent", v)}
              >
                {reorders[v]}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>
            한 줄 기억 <small>선택</small>
          </span>
          <textarea
            maxLength={1000}
            rows={2}
            placeholder="첫 입의 느낌, 오늘의 발견…"
            value={draft.short_note}
            onChange={(e) => update("short_note", e.target.value)}
          />
        </label>
        <button
          type="button"
          className="expand-button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
            setSuggest(false);
          }}
        >
          장소, 날짜, 사진과 더 자세한 기록
          <ChevronDown size={17} className={expanded ? "rotated" : ""} />
        </button>
        {expanded && (
          <div className="expanded-fields">
            <div className="form-columns">
              <label className="field">
                <span>브랜드</span>
                <input
                  list="brands"
                  disabled={!!draft.menu_id}
                  maxLength={200}
                  placeholder="독립 식당은 비워 두세요"
                  value={draft.brand_name}
                  onChange={(e) => update("brand_name", e.target.value)}
                />
                <datalist id="brands">
                  {archive.brands.map((b) => (
                    <option value={b.name} key={b.id} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span>음식 종류</span>
                <input
                  list="categories"
                  disabled={!!draft.menu_id}
                  maxLength={100}
                  placeholder="버거, 한식, 커피…"
                  value={draft.category}
                  onChange={(e) => update("category", e.target.value)}
                />
                <datalist id="categories">
                  {[
                    ...new Set(
                      archive.menus.map((m) => m.category).filter(Boolean),
                    ),
                  ].map((c) => (
                    <option value={c} key={c} />
                  ))}
                </datalist>
              </label>
            </div>
            <label className="field">
              <span>어디에서 먹었나요?</span>
              <input
                list="places"
                maxLength={200}
                placeholder="기존 장소를 찾거나 새 장소 입력"
                value={draft.place_name}
                onChange={(e) => update("place_name", e.target.value)}
              />
              <datalist id="places">
                {archive.places
                  .filter(
                    (p) =>
                      !draft.brand_name ||
                      archive.brands.find((b) => b.id === p.brand_id)?.name ===
                        draft.brand_name,
                  )
                  .map((p) => (
                    <option value={p.name} key={p.id} />
                  ))}
              </datalist>
            </label>
            <label className="field">
              <span>주소 또는 동네</span>
              <input
                maxLength={2000}
                value={draft.address}
                placeholder="예: 서울 마포구 연남동"
                onChange={(e) => update("address", e.target.value)}
              />
            </label>
            <div className="form-columns">
              <label className="field">
                <span>날짜</span>
                <input
                  type="date"
                  required
                  value={draft.eaten_at}
                  onChange={(e) => update("eaten_at", e.target.value)}
                />
              </label>
              <label className="field">
                <span>지불한 가격 · 원</span>
                <input
                  type="number"
                  min={0}
                  max={100000000}
                  step="any"
                  placeholder="0"
                  value={draft.price_paid ?? ""}
                  onChange={(e) =>
                    update(
                      "price_paid",
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                    )
                  }
                />
              </label>
            </div>
            <label className="field">
              <span>식사 방식</span>
              <select
                value={draft.dining_context}
                onChange={(e) =>
                  update("dining_context", e.target.value as Context)
                }
              >
                {[
                  ["DINE_IN", "매장에서"],
                  ["TAKEOUT", "포장"],
                  ["DELIVERY", "배달"],
                  ["HOME", "집에서"],
                  ["OTHER", "기타"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                태그 <small>쉼표로 구분</small>
              </span>
              <input
                maxLength={1000}
                placeholder="혼밥, 여행, 가성비"
                value={draft.tags.join(",")}
                onChange={(e) =>
                  update(
                    "tags",
                    e.target.value.split(",").map((t) => t.slice(0, 100)),
                  )
                }
              />
            </label>
            <label className="field">
              <span>조금 더 남길 이야기</span>
              <textarea
                rows={3}
                maxLength={20000}
                value={draft.detailed_note}
                onChange={(e) => update("detailed_note", e.target.value)}
              />
            </label>
            <div className="photo-strip">
              {draft.photos.map((p, i) => (
                <div key={i}>
                  <img src={p.storage_path} alt={`첨부 사진 ${i + 1}`} />
                  <button
                    type="button"
                    aria-label={`사진 ${i + 1} 제거`}
                    onClick={() =>
                      update(
                        "photos",
                        draft.photos.filter((_, j) => i !== j),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <label className="upload-button">
              <ImagePlus size={18} />
              {processing ? "사진을 압축하고 있어요…" : "사진 추가"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                multiple
                disabled={processing}
                onChange={(e) => {
                  void addPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="micro">최대 6장 · 긴 변 1,600px · 기기에만 저장</p>
          </div>
        )}
        {similar && (
          <div className="inline-notice">
            <p>“{similar.name}”와 같은 이름의 메뉴가 있습니다.</p>
            <button
              type="button"
              className="text-button"
              onClick={() => selectMenu(similar.id)}
            >
              기존 메뉴 사용
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => update("force_new_menu", true)}
            >
              별도 메뉴로 만들기
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary save-button"
          type="submit"
          disabled={processing || !!similar}
        >
          <Check size={18} />
          {record ? "변경 저장" : "기억 저장하기"}
        </button>
        <p className="micro text-center">PRIVATE BY DEFAULT. ALWAYS YOURS.</p>
      </form>
    </Modal>
  );
}
