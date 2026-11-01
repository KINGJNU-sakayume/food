import { useEffect, useState } from "react";
import { ArrowLeft, Check, FileJson, Inbox, Plus, ShieldAlert, X } from "lucide-react";
import type { Archive, RecordDraft } from "../types/model";
import type { CandidateEnvelope } from "../lib/lifehub-contract";
import { candidateKey, validateCandidate } from "../lib/lifehub-contract";
import { approveCandidate, type CandidateReview } from "../lib/lifehub-approval";
import {
  addLocalCandidate, completeLocalCandidate, exampleCandidates, readLocalInbox,
  rejectLocalCandidate, inboxStorageKey,
} from "../lib/lifehub-local";

type Save = (fn: (archive: Archive) => Archive) => Promise<boolean>;
type MealFields = {
  menu: string; place: string; address: string; eaten: string;
  verdict: "" | RecordDraft["verdict"];
  reorder: "" | RecordDraft["reorder_intent"]; note: string;
};
const blank: MealFields = { menu:"", place:"", address:"", eaten:"", verdict:"", reorder:"", note:"" };
export default function LifeHubInboxPage({ archive, onSave }: { archive: Archive; onSave: Save }) {
  const [entries, setEntries] = useState<CandidateEnvelope[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState<"pending"|"all">("pending");
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [meal, setMeal] = useState<MealFields>(blank);
  const [wish, setWish] = useState({ name:"", address:"", url:"" });

  const reload = () => {
    try { setEntries(readLocalInbox(archive)); setError(""); }
    catch (e) { setError("후보함을 읽을 수 없습니다: " + (e as Error).message); }
  };
  useEffect(() => {
    reload();
    const refresh = (event: StorageEvent) => {
      if (event.key === inboxStorageKey(archive.user.id)) reload();
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
    // archive receipts are reconciled when the archive changes.
  }, [archive]);
  const active = entries.find(e => e.key === selected);
  useEffect(() => {
    if (!active) { setMeal(blank); setWish({name:"",address:"",url:""}); return; }
    const c = active.candidate;
    if (c.candidate_type === "meal") {
      setMeal({
        menu:c.payload.menu_name, place:c.payload.place_name || "",
        address:"", eaten:c.payload.eaten_at || "",
        verdict:c.payload.verdict || "", reorder:c.payload.reorder_intent || "",
        note:c.payload.note || "",
      });
    } else setWish({name:c.payload.name,address:"",url:c.payload.source_url || ""});
  }, [selected]);
  const shown = filter === "all" ? entries : entries.filter(e => e.status === "pending");
  const pending = entries.filter(e => e.status === "pending").length;

  function importCandidates(items: unknown[]) {
    // Validate ALL before modifying local storage.
    items.forEach(validateCandidate);
    let inserted = 0;
    for (const item of items) {
      const result = addLocalCandidate(archive, item);
      if (result.result === "inserted") inserted++;
    }
    reload();
    setNotice(inserted + "개 후보를 추가했습니다. 기존 식사 기록은 변경되지 않았습니다.");
    setError("");
  }
  const examples = () => {
    try { importCandidates(exampleCandidates()); }
    catch (e) { setError((e as Error).message); }
  };
  const onImport = () => {
    try {
      if (!importText.trim() || importText.length > 32_000) throw new Error("32KB 이하 후보 JSON을 입력해 주세요.");
      const parsed: unknown = JSON.parse(importText);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      if (!items.length || items.length > 20) throw new Error("한 번에 1~20개 후보만 가져올 수 있습니다.");
      importCandidates(items);
      setImportText(""); setShowImport(false);
    } catch (e) { setError((e as Error).message); }
  };
  const reject = (entry: CandidateEnvelope) => {
    try {
      rejectLocalCandidate(archive, entry.key);
      reload(); setSelected(""); setNotice("기록 후보를 거절했습니다. 실제 식사 기록은 변경되지 않았습니다.");
    } catch (e) { setError((e as Error).message); }
  };
  async function approve() {
    if (!active || active.status !== "pending" || processing) return;
    setError("");
    let review: CandidateReview;
    if (active.candidate.candidate_type === "meal") {
      if (!meal.eaten || !meal.verdict || !meal.reorder) {
        setError("실제로 먹은 날짜, 호불호, 재주문 의사를 확인해 주세요.");
        return;
      }
      review = {
        candidate_type:"meal", menu_name:meal.menu, place_name:meal.place,
        address:meal.address, eaten_at:meal.eaten,
        verdict:meal.verdict, reorder_intent:meal.reorder, note:meal.note,
      };
    } else review = {
      candidate_type:"wish", name:wish.name, address:wish.address,
      source_url:wish.url.trim() || undefined,
    };
    setProcessing(true);
    try {
      let savedArchive: Archive | undefined;
      let targetId = "";
      const ok = await onSave(a => {
        const result = approveCandidate(a, active.candidate, review);
        savedArchive = result.archive;
        targetId = result.entity_id;
        return result.archive;
      });
      if (!ok) { setError("아카이브 저장이 완료되지 않았습니다. 기록은 승인되지 않았습니다."); return; }
      try {
        if (!savedArchive || !targetId) throw new Error("승인된 기록의 ID를 확인하지 못했습니다.");
        completeLocalCandidate(savedArchive, active.key, targetId);
        setEntries(readLocalInbox(savedArchive));
        setNotice("실제 아카이브에 승인된 기록을 저장했습니다.");
      } catch (e) {
        // A receipt is atomically persisted inside Archive. The next reload
        // reconciles it even if localStorage inbox write failed.
        setNotice("기록은 안전하게 저장됐습니다. 후보함 상태는 재접속 시 영수증으로 복구됩니다.");
        setError((e as Error).message);
      }
      setSelected("");
    } catch (e) { setError((e as Error).message); }
    finally { setProcessing(false); }
  }
  return <div className="p2-page hub-inbox">
    <a href="#/choose" className="p2-back"><ArrowLeft size={18}/> 고르기로 돌아가기</a>
    <div className="p2-eyebrow">LIFE HUB / LOCAL PREVIEW</div>
    <h1>기록 후보함</h1>
    <p className="p2-muted">Life Hub 서버가 연결되기 전의 로컬 테스트 화면입니다. 샘플과 직접 붙여넣은 JSON만 처리하며, ChatGPT·Claude에 연결된 상태는 아닙니다.</p>
    <div className="hub-inbox-tools">
      <button type="button" className="primary" onClick={examples}><Plus size={17}/> 테스트 후보 2개 불러오기</button>
      <button type="button" className="p2-quiet-btn" onClick={() => setShowImport(x => !x)}><FileJson size={17}/> 후보 JSON 직접 입력</button>
    </div>
    {showImport && <section className="hub-import"><h2>후보 JSON 검증</h2><p>수동으로 입력한 JSON의 출처는 인증되지 않습니다. 실제 외부 연결이 아니라 계약 검사 기능입니다.</p>
      <textarea aria-label="후보 JSON 입력" value={importText} onChange={e => setImportText(e.target.value)} rows={6} placeholder={'{"schema_version":1,"candidate_type":"meal",...}'}/>
      <button type="button" onClick={onImport} className="primary">검증 후 후보함에 추가</button>
    </section>}
    {error && <p role="alert" className="hub-error"><ShieldAlert size={17}/>{error}</p>}
    {notice && <p role="status" className="hub-notice">{notice}</p>}
    <div className="p2-section-head"><h2>검토할 기록</h2><span>{pending}개 대기</span></div>
    <div className="hub-inbox-filters">
      <button type="button" className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>대기 중</button>
      <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체 기록</button>
    </div>
    {!shown.length && <p className="hub-empty"><Inbox size={26}/> 검토할 후보가 없습니다. 샘플을 불러와 승인 과정을 시험해 보세요.</p>}
    <div className="hub-candidate-grid">
      <div className="hub-candidate-list">
        {shown.map(entry => <button type="button" key={entry.key} className={selected === entry.key ? "hub-candidate-item active" : "hub-candidate-item"} onClick={() => setSelected(entry.key)}>
          <span className="hub-type">{entry.candidate.candidate_type === "meal" ? "식사 후보" : "위시리스트 후보"} · {entry.candidate.source === "manual" ? "수동 테스트" : entry.candidate.source + " (수동 입력·미인증)"}</span>
          <strong>{entry.candidate.candidate_type === "meal" ? entry.candidate.payload.menu_name : entry.candidate.payload.name}</strong>
          <span>{entry.candidate.candidate_type === "meal" ? (entry.candidate.payload.place_name || "장소 미지정") : (entry.candidate.payload.wish_kind === "visit_place" ? "가보고 싶은 식당" : "먹고 싶은 메뉴")}</span>
          <small>{entry.status === "pending" ? "검토 대기" : entry.status === "confirmed" ? "승인됨" : "거절됨"}</small>
        </button>)}
      </div>
      <div className="hub-review">
        {!active ? <p className="p2-muted">왼쪽에서 후보를 선택하면 식사 날짜·평가·장소를 확인할 수 있습니다.</p> :
          <div key={active.key}>
            <div className="hub-review-title"><h2>후보 검토</h2><button type="button" onClick={() => setSelected("")} aria-label="검토 닫기"><X size={18}/></button></div>
            <p className="hub-meta">출처: {active.candidate.source} · 키: {active.candidate.idempotency_key}</p>
            {active.status !== "pending" ? <p className="hub-notice">{active.status === "confirmed" ? "이미 실제 기록에 반영된 후보입니다. 같은 요청으로 중복 생성되지 않습니다." : "거절된 후보입니다."}</p> :
              <>
                {active.candidate.candidate_type === "meal" ? <div className="hub-fields">
                  <label>메뉴<input aria-label="후보 메뉴" value={meal.menu} maxLength={200} onChange={e => setMeal(v=>({...v,menu:e.target.value}))}/></label>
                  <label>가게·지점<input aria-label="후보 가게" value={meal.place} maxLength={200} placeholder="해당되는 경우 입력" onChange={e => setMeal(v=>({...v,place:e.target.value}))}/></label>
                  <label>주소·동네<input aria-label="후보 주소" value={meal.address} maxLength={2000} placeholder="동명이점 구분에 도움이 됩니다" onChange={e => setMeal(v=>({...v,address:e.target.value}))}/></label>
                  <label>실제로 먹은 날짜 (필수)<input aria-label="후보 식사 날짜" type="date" value={meal.eaten} onChange={e => setMeal(v=>({...v,eaten:e.target.value}))}/></label>
                  <label>호불호 (필수)<select aria-label="후보 호불호" value={meal.verdict} onChange={e => setMeal(v=>({...v,verdict:e.target.value as MealFields["verdict"]}))}><option value="">선택하세요</option><option value="LIKE">호</option><option value="NEUTRAL">보통</option><option value="DISLIKE">불호</option></select></label>
                  <label>재주문 의사 (필수)<select aria-label="후보 재주문" value={meal.reorder} onChange={e => setMeal(v=>({...v,reorder:e.target.value as MealFields["reorder"]}))}><option value="">선택하세요</option><option value="YES">다시 먹겠다</option><option value="MAYBE">기회가 되면</option><option value="NO">다시 안 먹겠다</option></select></label>
                  <label className="hub-full">식사 메모<textarea aria-label="후보 메모" rows={3} value={meal.note} maxLength={1000} onChange={e => setMeal(v=>({...v,note:e.target.value}))}/></label>
                </div> : <div className="hub-fields">
                  <label>관심 대상 이름<input aria-label="후보 관심 이름" value={wish.name} maxLength={200} onChange={e => setWish(v=>({...v,name:e.target.value}))}/></label>
                  <label>주소·동네<input aria-label="후보 관심 주소" value={wish.address} onChange={e => setWish(v=>({...v,address:e.target.value}))}/></label>
                  <label className="hub-full">참고 URL (HTTPS)<input aria-label="후보 관심 URL" value={wish.url} onChange={e => setWish(v=>({...v,url:e.target.value}))}/></label>
                </div>}
                <p className="p2-muted hub-warning">이 내용을 실제 기록으로 저장합니다. 같은 음식 이름이라도 가게·지점을 확인하세요. 후보 검토만으로는 자동 저장되지 않습니다.</p>
                <div className="p2-actions">
                  <button className="primary" type="button" disabled={processing} onClick={() => { void approve(); }}><Check size={17}/>{processing ? "기록 저장 중…" : "확인하고 실제 기록으로 저장"}</button>
                  <button className="p2-quiet-btn" type="button" disabled={processing} onClick={() => reject(active)}>후보 거절</button>
                </div>
              </>}
          </div>}
      </div>
    </div>
  </div>;
}
