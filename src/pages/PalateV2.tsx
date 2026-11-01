import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Bookmark, ChevronLeft, ChevronRight, Heart, MapPin, Plus, Search, SlidersHorizontal } from "lucide-react";
import type { Archive, EatingRecord, Menu, Place, Verdict } from "../types/model";
import { normalize, preference, reorders, verdicts } from "../lib/data";
import { dateLabel, Empty, Modal, VerdictLabel } from "../components/Common";

type Add = (menuId?: string, placeId?: string) => void;
type Save = (fn: (a: Archive) => Archive, message?: string | false) => boolean;
type Group = { menu: Menu; place?: Place; placeId: string; records: EatingRecord[]; key: string };
const unplaced = "unplaced";
const sortRecords = (r: EatingRecord[]) => [...r].sort((a, b) => b.eaten_at.localeCompare(a.eaten_at) || b.created_at.localeCompare(a.created_at));
const groupHref = (g: Group) => "#/dish/" + encodeURIComponent(g.menu.id) + "/" + encodeURIComponent(g.placeId);
const placeName = (g: Group, a: Archive) => g.place?.name || a.brands.find(b => b.id === g.menu.brand_id)?.name || "장소 미지정";
const getPhotos = (a: Archive, r: EatingRecord) => a.photos.filter(p => p.eating_record_id === r.id).sort((x, y) => x.sort_order - y.sort_order);
function groups(a: Archive): Group[] {
  const result = new Map<string, Group>();
  for (const record of a.records) {
    const menu = a.menus.find(m => m.id === record.menu_id);
    if (!menu) continue;
    const placeId = record.place_id || unplaced;
    const key = menu.id + ":" + placeId;
    let group = result.get(key);
    if (!group) {
      group = { key, menu, placeId, place: a.places.find(p => p.id === record.place_id), records: [] };
      result.set(key, group);
    }
    group.records.push(record);
  }
  return [...result.values()].map(g => ({ ...g, records: sortRecords(g.records) }))
    .sort((x, y) => y.records[0].eaten_at.localeCompare(x.records[0].eaten_at));
}
function GroupCover({ archive, group, className = "" }: { archive: Archive; group: Group; className?: string }) {
  const photo = group.records.flatMap(r => getPhotos(archive, r))[0];
  const offering = archive.offerings.find(o => o.menu_id === group.menu.id && o.place_id === group.place?.id);
  const reference = offering?.reference_image_url;
  return (
    <div className={"p2-cover " + className}>
      {photo ? (
        <img src={photo.storage_path} alt={group.menu.name + " 실제 식사 사진"} loading="lazy" />
      ) : reference ? (
        <>
          <img src={reference} alt={group.menu.name + " 참고 이미지"} loading="lazy" referrerPolicy="no-referrer" />
          <span className="p2-ref-label">참고 이미지{offering?.reference_image_credit ? " · " + offering.reference_image_credit : ""}</span>
        </>
      ) : (
        <div className="p2-type-cover"><span>나의 메뉴 아카이브</span><strong>{group.menu.name}</strong><span>사진 없는 기록</span></div>
      )}
    </div>
  );
}
function Title({ eyebrow, title, caption }: { eyebrow: string; title: string; caption?: string }) {
  return <div className="p2-heading"><div className="p2-eyebrow">{eyebrow}</div><h1>{title}</h1>{caption && <p>{caption}</p>}</div>;
}
function GroupCard({ archive, group }: { archive: Archive; group: Group }) {
  const verdict = preference(group.records);
  return (
    <a className="p2-card" href={groupHref(group)}>
      <GroupCover archive={archive} group={group} />
      <div className="p2-card-copy">
        <div className="p2-place-name">{placeName(group, archive)}</div>
        <h2>{group.menu.name}</h2>
        <div className="p2-card-meta">{verdict && <VerdictLabel value={verdict} />}<span>· {group.records.length}번의 식사</span></div>
      </div>
    </a>
  );
}
export function ArchiveV2({ archive, onAdd, onDemo }: { archive: Archive; onAdd: Add; onDemo: () => void }) {
  const [view, setView] = useState<"menu" | "place">("menu");
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState("");
  const [sort, setSort] = useState("recent");
  const all = useMemo(() => groups(archive), [archive]);
  const filtered = all.filter(g => (!query || normalize(g.menu.name + " " + placeName(g, archive) + " " + (g.menu.category || "")).includes(normalize(query)))
    && (!verdict || preference(g.records) === verdict))
    .sort((a, b) => sort === "count" ? b.records.length - a.records.length :
      sort === "name" ? a.menu.name.localeCompare(b.menu.name, "ko") :
      b.records[0].eaten_at.localeCompare(a.records[0].eaten_at));
  const groupedPlaces = new Map<string, Group[]>();
  for (const g of filtered) {
    const key = g.place?.id || unplaced;
    groupedPlaces.set(key, [...(groupedPlaces.get(key) || []), g]);
  }
  return (
    <div className="p2-page">
      <Title eyebrow="MY FOOD ARCHIVE" title="먹어온 것들." caption={"메뉴 " + all.length + "종류 · 식사 " + archive.records.length + "번. 같은 메뉴도 가게별로 구분합니다."} />
      {!all.length ? (
        <div className="p2-empty"><Empty title="첫 식사의 기록을 기다리고 있어요." description="메뉴와 가게, 사진을 하나씩 쌓아 보세요." onAdd={() => onAdd()} /><button className="p2-link" onClick={onDemo}>예시 기록으로 살펴보기 <ArrowRight size={17}/></button></div>
      ) : (
        <>
          <div className="p2-toolbar">
            <div className="p2-switch" aria-label="아카이브 보기 방식">
              <button className={view === "menu" ? "selected" : ""} aria-pressed={view === "menu"} onClick={() => setView("menu")}>메뉴별</button>
              <button className={view === "place" ? "selected" : ""} aria-pressed={view === "place"} onClick={() => setView("place")}>가게별</button>
            </div>
            <label className="p2-search"><Search size={17}/><input aria-label="메뉴와 가게 검색" placeholder="메뉴 또는 가게 검색" value={query} onChange={e => setQuery(e.target.value)}/></label>
          </div>
          <div className="p2-filterline">
            <div className="p2-chips">{[["","전체"],["LIKE","호"],["NEUTRAL","보통"],["DISLIKE","불호"]].map(([k,v]) => <button className={verdict === k ? "selected" : ""} key={k} aria-pressed={verdict === k} onClick={() => setVerdict(k)}>{v}</button>)}</div>
            <label><SlidersHorizontal size={15}/><select aria-label="컬렉션 정렬" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">최근순</option><option value="count">많이 먹은 순</option><option value="name">이름순</option></select></label>
          </div>
          {view === "menu" ? <div className="p2-grid">{filtered.map(g => <GroupCard archive={archive} group={g} key={g.key}/>)}</div> :
            <div className="p2-places">{[...groupedPlaces.entries()].map(([id, items]) => <section key={id} className="p2-place-block"><div className="p2-section-head"><h2>{placeName(items[0], archive)}</h2>{id !== unplaced && <a href={"#/place-v2/" + encodeURIComponent(id)}>가게 보기 <ArrowRight size={16}/></a>}</div><div className="p2-grid">{items.map(g => <GroupCard archive={archive} group={g} key={g.key}/>)}</div></section>)}</div>}
          {!filtered.length && <Empty title="찾는 메뉴가 없습니다." description="필터 또는 검색어를 변경해 보세요."/>}
          <p className="p2-bottom-links"><a href="#/insights">나의 취향 통계 보기 <ArrowRight size={16}/></a><a href="#/places">기존 장소 관리 <ArrowRight size={16}/></a></p>
        </>
      )}
    </div>
  );
}
export function JournalV2({ archive, onAdd }: { archive: Archive; onAdd: Add }) {
  const [month, setMonth] = useState("all");
  const [query, setQuery] = useState("");
  const records = sortRecords(archive.records);
  const months = [...new Set(records.map(r => r.eaten_at.slice(0, 7)))];
  const visible = records.filter(r => (month === "all" || r.eaten_at.startsWith(month)) && (!query || normalize([
    archive.menus.find(m => m.id === r.menu_id)?.name,
    archive.places.find(p => p.id === r.place_id)?.name,
    r.short_note, r.detailed_note,
  ].join(" ")).includes(normalize(query))));
  return (
    <div className="p2-page">
      <Title eyebrow="FOOD JOURNAL" title="한 끼씩, 차곡차곡." caption="그날의 사진과 감상을 시간순으로 돌아봅니다."/>
      <div className="p2-toolbar">
        <select className="p2-month" aria-label="기록 월 선택" value={month} onChange={e => setMonth(e.target.value)}><option value="all">전체 기간</option>{months.map(m => <option key={m} value={m}>{m.slice(0,4)}년 {Number(m.slice(5,7))}월</option>)}</select>
        <label className="p2-search"><Search size={17}/><input aria-label="식사 일기 검색" placeholder="기억 검색" value={query} onChange={e => setQuery(e.target.value)} /></label>
      </div>
      {!archive.records.length ? <Empty title="첫 식사 일기를 작성해 보세요." description="그날 먹은 음식과 짧은 감상부터 시작해도 됩니다." onAdd={() => onAdd()}/> : !visible.length ? <Empty title="이 기간에는 기록이 없습니다." description="다른 기간이나 검색어로 찾아보세요."/> :
        <div className="p2-journal">{visible.map((r, i) => {
          const menu = archive.menus.find(m => m.id === r.menu_id);
          const place = archive.places.find(p => p.id === r.place_id);
          const photos = getPhotos(archive, r);
          return <article key={r.id} className="p2-journal-entry">
            {(i === 0 || r.eaten_at !== visible[i-1].eaten_at) && <div className="p2-journal-date">{dateLabel(r.eaten_at)}</div>}
            <a href={"#/meal/" + encodeURIComponent(r.id)} className="p2-journal-link">
              {photos.length > 0 && <div className="p2-journal-cover"><img src={photos[0].storage_path} alt={menu?.name + " 이 날의 식사 사진"} loading="lazy"/>{photos.length > 1 && <span>사진 {photos.length}장</span>}</div>}
              <div className="p2-journal-info"><div><h2>{menu?.name || "메뉴 미상"}</h2><VerdictLabel value={r.verdict}/></div><p className="p2-place-name">{place?.name || "장소 미지정"}</p>{r.short_note && <p className="p2-journal-note">{r.short_note}</p>}<span className="p2-read">그날의 기록 열기 <ArrowRight size={16}/></span></div>
            </a>
          </article>;
        })}</div>}
    </div>
  );
}
export function ChooseV2({ archive }: { archive: Archive }) {
  const [compared, setCompared] = useState<string[]>([]);
  const saved = groups(archive).filter(g => g.records[0].reorder_intent === "YES");
  const selectedGroups = saved.filter(g => compared.includes(g.key));
  const toggleCompare = (key: string) => setCompared(items => items.includes(key) ? items.filter(x => x !== key) : items.length < 3 ? [...items, key] : items);
  const wishes = archive.wishes.map(w => {
    const title = w.target_type === "MENU" ? archive.menus.find(m => m.id === w.target_id)?.name :
      w.target_type === "BRAND" ? archive.brands.find(b => b.id === w.target_id)?.name :
      archive.places.find(p => p.id === w.target_id)?.name;
    const href = w.target_type === "MENU" ? "#/menu/" + w.target_id : "#/choose/" + (w.target_type === "BRAND" ? "brand/" : "place/") + w.target_id;
    return { key: w.id, title, href, type: w.target_type };
  }).filter(w => w.title);
  return <div className="p2-page">
    <Title eyebrow="WHAT TO EAT NEXT" title="오늘, 뭐 먹지?" caption="이미 먹어본 메뉴와 저장해둔 발견을 바탕으로 고릅니다."/>
    <div className="p2-choose-quick"><a href="#/choose/places"><MapPin size={19}/> 내 음식점 둘러보기 <ArrowRight size={16}/></a><a href="#/choose/franchises"><BookOpen size={19}/> 프랜차이즈 메뉴 찾기 <ArrowRight size={16}/></a><a href="#/choose/reels"><Bookmark size={19}/> 릴스·저장 링크 ({archive.saved_links.length}) <ArrowRight size={16}/></a></div>
    <div className="p2-section-head"><h2>다시 먹고 싶은 메뉴</h2><span>{saved.length}개</span></div>
    {saved.length ? <div className="p2-choose-list">{saved.slice(0, 8).map(g => <div key={g.key} className="p2-compare-candidate"><a href={groupHref(g)} className="p2-choose-item"><GroupCover archive={archive} group={g}/><div><strong>{g.menu.name}</strong><span>{placeName(g, archive)}</span><small>{dateLabel(g.records[0].eaten_at)} · 다시 먹는다</small></div><ChevronRight size={18}/></a><button type="button" className={compared.includes(g.key) ? "p2-compare-selected" : ""} aria-pressed={compared.includes(g.key)} disabled={!compared.includes(g.key) && compared.length >= 3} onClick={() => toggleCompare(g.key)}>{compared.includes(g.key) ? "비교에서 제외" : "비교에 담기"}</button></div>)}</div> : <p className="p2-muted">재주문 의사를 ‘다시 먹는다’로 남긴 메뉴가 여기에 모입니다.</p>}
    {!!selectedGroups.length && <div className="p2-compare-panel"><div className="p2-section-head"><h2>지금 고민하는 메뉴</h2><button onClick={() => setCompared([])}>초기화</button></div><div className="p2-compare-grid">{selectedGroups.map(g => <a href={groupHref(g)} key={g.key}><strong>{g.menu.name}</strong><span>{placeName(g, archive)}</span><VerdictLabel value={preference(g.records) || g.records[0].verdict}/><p>{g.records[0].short_note || "지난 식사 메모 없음"}</p></a>)}</div><p className="p2-muted">최대 3개 · 지난 경험을 바탕으로 비교하며 자동 추천 순위는 만들지 않습니다.</p></div>}
    <div className="p2-section-head"><h2>먹고 싶은 것과 가고 싶은 곳</h2><span>{wishes.length}개</span></div>
    {wishes.length ? <div className="p2-choose-list">{wishes.slice(0, 12).map(w => <a key={w.key} href={w.href} className="p2-choose-item p2-wish-item"><Heart size={19}/><div><strong>{w.title}</strong><span>{w.type === "MENU" ? "관심 메뉴" : w.type === "PLACE" ? "방문하고 싶은 장소" : "관심 브랜드"}</span></div><ChevronRight size={18}/></a>)}</div> : <p className="p2-muted">관심 메뉴나 가게를 저장하면 여기에 나타납니다.</p>}
    <div className="p2-section-head"><h2>나중에 찾아볼 발견</h2><a href="#/choose/reels">전체 보기 <ArrowRight size={16}/></a></div>
    {archive.saved_links.slice(0, 3).map(l => <a className="p2-saved-link" href="#/choose/reels" key={l.id}><Bookmark size={17}/><span>{l.title || l.note || "저장한 링크"}</span><ArrowRight size={16}/></a>)}
    {!archive.saved_links.length && <p className="p2-muted">릴스와 음식점 링크는 기존 보관함에서 그대로 관리할 수 있습니다.</p>}
  </div>;
}
export function PlaceV2({ archive, id, onAdd }: { archive: Archive; id: string; onAdd: Add }) {
  const place = archive.places.find(p => p.id === id);
  if (!place) return <Empty title="장소를 찾지 못했습니다." description="기록이 삭제된 것인지 확인해 주세요."/>;
  const items = groups(archive).filter(g => g.place?.id === id);
  return <div className="p2-page"><a className="p2-back" href="#/collection"><ArrowLeft size={18}/> 아카이브</a>
    <Title eyebrow="PLACE ARCHIVE" title={place.name} caption={[place.address, items.length + "개 메뉴", items.reduce((n,g) => n + g.records.length, 0) + "번의 식사"].filter(Boolean).join(" · ")}/>
    <div className="p2-actions"><button className="primary" onClick={() => onAdd(undefined, id)}><Plus size={17}/> 이곳에서 먹은 기록</button><a className="p2-quiet-btn" href={"#/places/" + id}>장소 정보 관리 <ArrowRight size={16}/></a></div>
    <div className="p2-section-head"><h2>여기서 먹어본 메뉴</h2></div>
    {items.length ? <div className="p2-grid">{items.map(g => <GroupCard archive={archive} group={g} key={g.key}/>)}</div> : <Empty title="아직 식사 기록이 없습니다." description="첫 식사를 기록해 주세요." onAdd={() => onAdd(undefined, id)}/>}
  </div>;
}
export function DishV2({ archive, menuId, placeId, onAdd, onSave }: { archive: Archive; menuId: string; placeId: string; onAdd: Add; onSave: Save }) {
  const group = groups(archive).find(g => g.menu.id === menuId && g.placeId === placeId);
  const [editing, setEditing] = useState(false);
  const offering = archive.offerings.find(o => o.menu_id === menuId && o.place_id === placeId);
  const [reference, setReference] = useState(offering?.reference_image_url || "");
  const [credit, setCredit] = useState(offering?.reference_image_credit || "");
  if (!group) return <Empty title="메뉴 기록을 찾지 못했습니다." description="가게별 기록이 존재하는지 확인해 주세요."/>;
  const v = preference(group.records);
  const other = groups(archive).filter(g => g.menu.id === menuId && g.placeId !== placeId);
  const saveReference = () => {
    const url = reference.trim();
    if (url && (!/^https:\/\//i.test(url) || !credit.trim())) return;
    const ok = onSave(a => {
      const next = structuredClone(a);
      let o = next.offerings.find(o => o.menu_id === menuId && o.place_id === placeId);
      if (!o && placeId !== unplaced) {
        o = { id: crypto.randomUUID(), user_id: next.user.id, created_at: new Date().toISOString(), menu_id: menuId, place_id: placeId, currency: "KRW", available: true };
        next.offerings.push(o);
      }
      if (o) { o.reference_image_url = url || undefined; o.reference_image_credit = url ? credit.trim() : undefined; }
      return next;
    }, "참고 이미지 정보를 저장했습니다.");
    if (ok) setEditing(false);
  };
  const latest = group.records[0];
  return <div className="p2-page p2-detail">
    <a href="#/collection" className="p2-back"><ArrowLeft size={18}/> 아카이브</a>
    <div className="p2-dish-layout">
      <GroupCover archive={archive} group={group} className="p2-hero-cover"/>
      <div className="p2-dish-copy"><div className="p2-eyebrow">MENU AT A PLACE</div>
        {group.place ? <a className="p2-venue-strong" href={"#/place-v2/" + group.place.id}>{group.place.name} <ArrowRight size={17}/></a> : <div className="p2-venue-strong">{placeName(group, archive)}</div>}
        <h1>{group.menu.name}</h1>
        <p className="p2-muted">{group.menu.category || "나의 메뉴"} · {group.records.length}번 먹음</p>
        <div className="p2-dish-summary">{v ? <VerdictLabel value={v}/> : null}<span>최근 기록 {dateLabel(latest.eaten_at)}</span></div>
        <div className="p2-actions"><button className="primary" onClick={() => onAdd(menuId, group.place?.id)}><Plus size={17}/> 다시 먹은 기록</button><a className="p2-quiet-btn" href={"#/menu/" + menuId}>메뉴 정보 수정 <ArrowRight size={16}/></a></div>
        {group.place && <details className="p2-ref-editor" open={editing} onToggle={e => setEditing(e.currentTarget.open)}><summary>컬렉션 참고 이미지 관리</summary><p>직접 촬영한 사진이 없을 때만 컬렉션에 표시됩니다. 일기에는 나타나지 않습니다.</p><label>이미지 HTTPS 주소<input type="url" value={reference} onChange={e => setReference(e.target.value)} placeholder="https://..."/></label><label>이미지 출처 (필수)<input value={credit} maxLength={200} onChange={e => setCredit(e.target.value)} placeholder="출처 또는 저작자"/></label><button className="p2-quiet-btn" onClick={saveReference} disabled={!!reference && (!/^https:\/\//i.test(reference) || !credit.trim())}>참고 이미지 저장</button></details>}
      </div>
    </div>
    <div className="p2-section-head"><h2>이 메뉴의 식사 연대기</h2><span>{group.records.length}번</span></div>
    <div className="p2-timeline">{group.records.map((r, i) => {
      const photo = getPhotos(archive, r)[0];
      return <a key={r.id} className="p2-timeline-item" href={"#/meal/" + encodeURIComponent(r.id)}><div className="p2-timeline-dot"/><div className="p2-timeline-content"><div className="p2-timeline-top"><time>{dateLabel(r.eaten_at)}</time><VerdictLabel value={r.verdict}/></div>{r.short_note && <p>{r.short_note}</p>}<span>{i === group.records.length - 1 ? "첫 식사" : i === 0 ? "가장 최근" : "이전 식사"} · {reorders[r.reorder_intent]}</span></div>{photo && <img src={photo.storage_path} alt="해당 날짜 식사 사진" loading="lazy"/>}<ChevronRight size={17}/></a>;
    })}</div>
    {other.length > 0 && <><div className="p2-section-head"><h2>다른 곳에서 먹은 같은 메뉴</h2></div><div className="p2-related">{other.map(g => <a key={g.key} href={groupHref(g)}>{placeName(g, archive)} <span>{g.records.length}번</span><ArrowRight size={17}/></a>)}</div></>}
  </div>;
}
export function MealV2({ archive, recordId, onEdit, onDelete }: { archive: Archive; recordId: string; onEdit: (r: EatingRecord) => void; onDelete: (r: EatingRecord) => void }) {
  const record = archive.records.find(r => r.id === recordId);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  if (!record) return <Empty title="식사 기록을 찾지 못했습니다." description="삭제된 기록인지 확인해 주세요."/>;
  const menu = archive.menus.find(m => m.id === record.menu_id);
  const place = archive.places.find(p => p.id === record.place_id);
  const photos = getPhotos(archive, record);
  const history = groups(archive).find(g => g.menu.id === record.menu_id && g.placeId === (record.place_id || unplaced));
  const back = history ? groupHref(history) : "#/journal";
  const prev = history?.records.find(r => r.id !== record.id && r.eaten_at <= record.eaten_at);
  return <div className="p2-page p2-meal-detail">
    <a className="p2-back" href="#/journal"><ArrowLeft size={18}/> 일기</a>
    <div className="p2-eyebrow">A SINGLE MEAL</div>
    <h1>{dateLabel(record.eaten_at)}</h1>
    <p className="p2-meal-venue">{place?.name || "장소 미지정"}</p>
    {photos.length > 0 && <div className="p2-photo-gallery"><button className="p2-photo-zoom" onClick={() => setZoom(true)} aria-label="식사 사진 크게 보기"><img src={photos[Math.min(index, photos.length-1)].storage_path} alt={(menu?.name || "음식") + " 식사 사진 " + (index + 1)}/></button>{photos.length > 1 && <div className="p2-gallery-controls"><button aria-label="이전 사진" onClick={() => setIndex((index + photos.length - 1) % photos.length)}><ChevronLeft size={20}/></button><span>{index + 1} / {photos.length}</span><button aria-label="다음 사진" onClick={() => setIndex((index + 1) % photos.length)}><ChevronRight size={20}/></button></div>}</div>}
    <div className="p2-meal-copy"><h2>{menu?.name || "메뉴 미상"}</h2><div className="p2-meal-facts"><VerdictLabel value={record.verdict}/><span>{reorders[record.reorder_intent]}</span>{record.price_paid !== undefined && <span>₩{record.price_paid.toLocaleString("ko-KR")}</span>}</div>{record.short_note && <p>{record.short_note}</p>}{record.detailed_note && <p>{record.detailed_note}</p>}{!record.short_note && !record.detailed_note && <p className="p2-muted">남겨진 메모는 없습니다.</p>}
      <div className="p2-actions"><button className="p2-quiet-btn" onClick={() => onEdit(record)}>기록 수정</button><button className="p2-quiet-btn" onClick={() => onDelete(record)}>기록 삭제</button></div>
      {history && <a className="p2-history-link" href={back}>이 가게 메뉴의 기록 전체 보기 <ArrowRight size={17}/></a>}
      {prev && <a className="p2-previous" href={"#/meal/" + prev.id}><span>이전에 먹었을 때 · {dateLabel(prev.eaten_at)}</span><strong>{verdicts[prev.verdict].label} — {prev.short_note || "메모 없음"}</strong></a>}
    </div>
    {zoom && photos.length > 0 && <Modal title="식사 사진 보기" onClose={() => setZoom(false)} wide><div className="p2-zoom"><img alt={(menu?.name || "음식") + " 사진 크게 보기"} src={photos[Math.min(index, photos.length-1)].storage_path}/><div className="p2-gallery-controls"><button onClick={() => setIndex((index + photos.length - 1) % photos.length)} aria-label="이전 사진"><ChevronLeft/></button><span>{index + 1} / {photos.length}</span><button onClick={() => setIndex((index + 1) % photos.length)} aria-label="다음 사진"><ChevronRight/></button></div><a download={(menu?.name || "palate") + "-" + record.eaten_at + ".webp"} className="p2-link" href={photos[Math.min(index, photos.length-1)].storage_path}>사진 저장</a></div></Modal>}
  </div>;
}
