import { useEffect, useState } from "react";
import { ArrowLeft, Check, FileJson, Inbox, Link2, Plus, RefreshCw, ShieldAlert, Unlink, X } from "lucide-react";
import type { Archive, RecordDraft } from "../types/model";
import type { CandidateEnvelope } from "../lib/lifehub-contract";
import { candidateKey, validateCandidate } from "../lib/lifehub-contract";
import { approveCandidate, type CandidateReview } from "../lib/lifehub-approval";
import { STORAGE_KEY } from "../lib/data";
import { primaryEnabled } from "../lib/storage-primary";
import {
  addLocalCandidate, completeLocalCandidate, exampleCandidates, readLocalInbox,
  rejectLocalCandidate, inboxStorageKey,
} from "../lib/lifehub-local";
import {
  beginConnect, browserDeps, completeConnect, connectAvailable, disconnect, isAuthCallback, isConnected,
  LifeHubError, remoteKeys, remoteOutcomes, autoApplyEnabled, setAutoApply, type OutcomeState,
} from "../lib/lifehub-remote";
import { runLifeHubSync } from "../lib/lifehub-autosync";
import { PALATE_APP_URL } from "../lib/lifehub-config";

// React StrictMode runs effects twice in development; the one-time code exchange must not.
let callbackOnce: Promise<void> | null = null;

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
  const [connected, setConnected] = useState(() => isConnected(browserDeps()));
  const [syncing, setSyncing] = useState(false);
  const [hubKeys, setHubKeys] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Record<string, OutcomeState>>({});
  const [autoApply, setAutoApplyState] = useState(() => autoApplyEnabled(browserDeps()));
  const canConnect = connectAvailable(location);

  const reload = (current: Archive = archive) => {
    try {
      setEntries(readLocalInbox(current)); setError("");
      const deps = browserDeps();
      setHubKeys(remoteKeys(current, deps)); setOutcomes(remoteOutcomes(current, deps));
    }
    catch (e) { setError("후보함을 읽을 수 없습니다: " + (e as Error).message); }
  };
  // The inbox is stored per archive user: persist a brand-new archive's user ID before writing it.
  async function ensureUserSaved() {
    if (!primaryEnabled() && !localStorage.getItem(STORAGE_KEY)) {
      if (!await onSave(a => a))
        throw new Error("후보함의 사용자 ID를 안전하게 저장하지 못했습니다.");
    }
  }
  async function sync(current: Archive = archive, quiet = false) {
    if (syncing) return;
    setSyncing(true);
    try {
      await ensureUserSaved();
      const s = await runLifeHubSync(current, onSave, browserDeps());
      reload(s.archive);
      if (!quiet || s.imported || s.conflicts || s.applied) {
        const parts = [s.imported ? `새 후보 ${s.imported}개를 가져왔어요` : "새 후보는 없어요"];
        if (s.applied) parts.push(`Claude에서 승인한 ${s.applied}개를 저장했어요`);
        if (s.receiptsSent || s.rejectionsSent) parts.push(`승인 ${s.receiptsSent}개·거절 ${s.rejectionsSent}개를 Life Hub에 알렸어요`);
        if (s.waiting) parts.push(`${s.waiting}개는 다음 동기화 때 다시 보낼게요`);
        setNotice(parts.join(" · ") + ".");
      }
      if (s.conflicts) setError(`${s.conflicts}개 후보는 Life Hub와 상태가 달라요. PALATE에 저장된 기록은 그대로 유지돼요.`);
    } catch (e) {
      if (e instanceof LifeHubError && e.kind === "not_connected") setConnected(false);
      setError((e as Error).message);
    } finally { setSyncing(false); }
  }
  async function connect() {
    try { location.assign(await beginConnect(browserDeps())); }
    catch (e) { setError((e as Error).message); }
  }
  function disconnectHub() {
    if (!confirm("이 기기에서 Life Hub 연결을 해제할까요? 이미 가져온 후보와 기록은 그대로 남아요.")) return;
    disconnect(browserDeps());
    setConnected(false);
    setNotice("Life Hub 연결을 해제했어요.");
  }
  useEffect(() => {
    void (async () => {
      if (isAuthCallback(location.search)) {
        callbackOnce ??= completeConnect(location.search, browserDeps());
        try {
          await callbackOnce;
          setConnected(true);
          setNotice("Life Hub에 연결했어요.");
        } catch (e) { setError((e as Error).message); }
        history.replaceState(null, "", PALATE_APP_URL + "#/inbox");
      }
      if (isConnected(browserDeps())) await sync(archive, true);
    })();
    // Run once on open; later syncs are explicit or follow an approval/rejection.
  }, []);
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

  async function importCandidates(items: unknown[]) {
    // Validate ALL before modifying local storage.
    items.forEach(validateCandidate);
    // Persist the generated user ID before writing a user-scoped inbox.
    // Otherwise a new emptyArchive() on reload makes its entries invisible.
    await ensureUserSaved();
    let inserted = 0;
    for (const item of items) {
      const result = addLocalCandidate(archive, item);
      if (result.result === "inserted") inserted++;
    }
    reload();
    setNotice(inserted + "개 후보를 추가했습니다. 기존 식사 기록은 변경되지 않았습니다.");
    setError("");
  }
  const examples = async () => {
    try { await importCandidates(exampleCandidates()); }
    catch (e) { setError((e as Error).message); }
  };
  const onImport = async () => {
    try {
      if (!importText.trim() || importText.length > 32_000) throw new Error("32KB 이하 후보 JSON을 입력해 주세요.");
      const parsed: unknown = JSON.parse(importText);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      if (!items.length || items.length > 20) throw new Error("한 번에 1~20개 후보만 가져올 수 있습니다.");
      await importCandidates(items);
      setImportText(""); setShowImport(false);
    } catch (e) { setError((e as Error).message); }
  };
  const reject = (entry: CandidateEnvelope) => {
    try {
      rejectLocalCandidate(archive, entry.key);
      reload(); setSelected(""); setNotice("기록 후보를 거절했습니다. 실제 식사 기록은 변경되지 않았습니다.");
      if (connected && hubKeys.has(entry.key)) void sync(archive, true);
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
        reload(savedArchive);
        setNotice("실제 아카이브에 승인된 기록을 저장했습니다.");
        // The receipt is already in the Archive; telling Life Hub can safely happen later too.
        if (connected && hubKeys.has(active.key)) void sync(savedArchive, true);
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
    <div className="p2-eyebrow">LIFE HUB</div>
    <h1>기록 후보함</h1>
    <p className="p2-muted">Claude 등에서 Life Hub로 제안된 음식 후보를 확인하고, 직접 승인한 것만 실제 기록으로 저장합니다. 승인·거절 결과는 Life Hub에도 알려 줍니다.</p>
    <section className="hub-connection" aria-label="Life Hub 연결">
      {connected ? <>
        <span className="hub-connection-state"><Link2 size={16}/> Life Hub에 연결됨</span>
        <button type="button" className="primary" disabled={syncing} onClick={() => { void sync(); }}><RefreshCw size={17}/>{syncing ? "동기화 중…" : "지금 동기화"}</button>
        <button type="button" className="p2-quiet-btn" onClick={disconnectHub}><Unlink size={17}/> 연결 해제</button>
        <label className="hub-auto-apply"><input type="checkbox" checked={autoApply} onChange={e => { setAutoApply(browserDeps(), e.target.checked); setAutoApplyState(e.target.checked); if (e.target.checked) void sync(archive, true); }}/> Claude에서 승인된 항목 자동 반영</label>
      </> : <>
        <span className="hub-connection-state">Life Hub에 연결되어 있지 않아요</span>
        <button type="button" className="primary" disabled={!canConnect} onClick={() => { void connect(); }}><Link2 size={17}/> Life Hub 연결</button>
        {!canConnect && <small>배포된 PALATE 주소에서만 연결할 수 있어요.</small>}
      </>}
    </section>
    <div className="hub-inbox-tools">
      <button type="button" className="primary" onClick={() => { void examples(); }}><Plus size={17}/> 테스트 후보 2개 불러오기</button>
      <button type="button" className="p2-quiet-btn" onClick={() => setShowImport(x => !x)}><FileJson size={17}/> 후보 JSON 직접 입력</button>
    </div>
    {showImport && <section className="hub-import"><h2>후보 JSON 검증</h2><p>수동으로 입력한 JSON의 출처는 인증되지 않습니다. 실제 외부 연결이 아니라 계약 검사 기능입니다.</p>
      <textarea aria-label="후보 JSON 입력" value={importText} onChange={e => setImportText(e.target.value)} rows={6} placeholder={'{"schema_version":1,"candidate_type":"meal",...}'}/>
      <button type="button" onClick={() => { void onImport(); }} className="primary">검증 후 후보함에 추가</button>
    </section>}
    {error && <p role="alert" className="hub-error"><ShieldAlert size={17}/>{error}</p>}
    {notice && <p role="status" className="hub-notice">{notice}</p>}
    <div className="p2-section-head"><h2>검토할 기록</h2><span>{pending}개 대기</span></div>
    <div className="hub-inbox-filters">
      <button type="button" className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>대기 중</button>
      <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체 기록</button>
    </div>
    {!shown.length && <p className="hub-empty"><Inbox size={26}/> {connected ? "검토할 후보가 없습니다. Claude에서 먹은 음식을 말하면 여기로 들어와요." : "검토할 후보가 없습니다. Life Hub를 연결하거나 샘플로 승인 과정을 시험해 보세요."}</p>}
    <div className="hub-candidate-grid">
      <div className="hub-candidate-list">
        {shown.map(entry => <button type="button" key={entry.key} className={selected === entry.key ? "hub-candidate-item active" : "hub-candidate-item"} onClick={() => setSelected(entry.key)}>
          <span className="hub-type">{entry.candidate.candidate_type === "meal" ? "식사 후보" : "위시리스트 후보"} · {hubKeys.has(entry.key) ? entry.candidate.source + " · Life Hub" : entry.candidate.source === "manual" ? "수동 테스트" : entry.candidate.source + " (수동 입력·미인증)"}</span>
          <strong>{entry.candidate.candidate_type === "meal" ? entry.candidate.payload.menu_name : entry.candidate.payload.name}</strong>
          <span>{entry.candidate.candidate_type === "meal" ? (entry.candidate.payload.place_name || "장소 미지정") : (entry.candidate.payload.wish_kind === "visit_place" ? "가보고 싶은 식당" : "먹고 싶은 메뉴")}</span>
          <small>{entry.status === "pending" ? (entry.hub_status === "approved" ? (entry.needs_app_review ? "Claude에서 승인함 · 확인 필요" : "Claude에서 승인함") : "검토 대기") : entry.status === "confirmed" ? "승인됨" : "거절됨"}
            {hubKeys.has(entry.key) && entry.status !== "pending" && (outcomes[entry.key] === "conflict" ? " · Life Hub와 상태 다름" : outcomes[entry.key] ? " · Life Hub 반영됨" : " · Life Hub 전송 대기")}</small>
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
                {active.hub_status === "approved" && <p className="hub-notice">Claude 카드에서 승인한 후보예요. {active.needs_app_review ? "PALATE에서 한 번 더 확인해 달라고 했어요." : "빠진 값을 채우거나 자동 반영이 꺼져 있어 여기서 확인해요."}</p>}
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
