import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Plus,
  SlidersHorizontal,
  Search,
  LayoutGrid,
  List,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import type {
  Archive,
  EatingRecord,
  Menu,
  Reorder,
  Verdict,
} from "../types/model";
import {
  isFavourite,
  menuRecords,
  normalize,
  preference,
  reorders,
  searchable,
  verdicts,
  updateMenuInfo,
} from "../lib/data";
import {
  dateLabel,
  Empty,
  MenuCover,
  MenuTile,
  VerdictLabel,
} from "../components/Common";
import { WantButton } from "../components/DiscoveryCommon";

type Add = (menuId?: string) => void;
const heading = {
  collection: [
    "COLLECTION",
    "먹어온 것들.",
    "한 번의 식사도, 여러 번의 익숙함도.",
  ],
  journal: [
    "JOURNAL",
    "한 끼씩, 차곡차곡.",
    "입맛은 매일 조금씩 다른 이야기를 씁니다.",
  ],
  places: ["PLACES", "맛을 만난 장소.", "메뉴가 기억을 남긴 자리."],
  insights: ["YOUR TASTE", "쌓여가는 취향.", "정답 없이, 오직 나의 기록으로."],
};
export function PageHeading({
  page,
  children,
}: {
  page: keyof typeof heading;
  children?: React.ReactNode;
}) {
  const [label, title, description] = heading[page];
  return (
    <header className="page-heading">
      <div>
        <div className="eyebrow">{label}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </header>
  );
}

interface Filters {
  verdict: string;
  reorder: string;
  brand: string;
  category: string;
  tag: string;
  from: string;
  to: string;
  first: boolean;
}
const initialFilters: Filters = {
  verdict: "",
  reorder: "",
  brand: "",
  category: "",
  tag: "",
  from: "",
  to: "",
  first: false,
};
function matchesRecord(a: Archive, r: EatingRecord, f: Filters) {
  const m = a.menus.find((m) => m.id === r.menu_id);
  return (
    (!f.verdict || r.verdict === f.verdict) &&
    (!f.reorder || r.reorder_intent === f.reorder) &&
    (!f.brand || m?.brand_id === f.brand) &&
    (!f.category || m?.category === f.category) &&
    (!f.tag ||
      a.record_tags.some(
        (t) => t.eating_record_id === r.id && t.tag_id === f.tag,
      )) &&
    (!f.from || r.eaten_at >= f.from) &&
    (!f.to || r.eaten_at <= f.to) &&
    (!f.first || menuRecords(a, r.menu_id).at(-1)?.id === r.id)
  );
}
function FilterBar({
  archive,
  filters,
  setFilters,
  query,
  setQuery,
}: {
  archive: Archive;
  filters: Filters;
  setFilters: (f: Filters) => void;
  query: string;
  setQuery: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const update = (key: keyof Filters, value: string | boolean) =>
    setFilters({ ...filters, [key]: value });
  const count = Object.values(filters).filter(Boolean).length;
  return (
    <>
      <div className="filterbar">
        <div className="verdict-tabs" aria-label="평가 필터">
          {[
            ["", "전체"],
            ["LIKE", "호"],
            ["NEUTRAL", "보통"],
            ["DISLIKE", "불호"],
          ].map(([v, label]) => (
            <button
              key={v}
              aria-pressed={filters.verdict === v}
              className={filters.verdict === v ? "active" : ""}
              onClick={() => update("verdict", v)}
            >
              {label}
              {v && (
                <span className={`tab-mark ${v.toLowerCase()}`}>
                  {verdicts[v as Verdict].mark}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="filter-tools">
          <label className="search-input">
            <Search size={17} />
            <input
              aria-label="메뉴, 장소, 태그와 메모 검색"
              placeholder="메뉴, 장소, 기억 찾기"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="검색 지우기" onClick={() => setQuery("")}>
                <X size={14} />
              </button>
            )}
          </label>
          <button
            className={`filter-toggle ${count ? "has-filters" : ""}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <SlidersHorizontal size={17} />
            <span>필터{count ? ` ${count}` : ""}</span>
          </button>
        </div>
      </div>
      {open && (
        <div className="filter-panel">
          <label>
            재주문
            <select
              value={filters.reorder}
              onChange={(e) => update("reorder", e.target.value)}
            >
              <option value="">전체</option>
              {Object.entries(reorders).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            브랜드
            <select
              value={filters.brand}
              onChange={(e) => update("brand", e.target.value)}
            >
              <option value="">전체</option>
              {archive.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            음식 종류
            <select
              value={filters.category}
              onChange={(e) => update("category", e.target.value)}
            >
              <option value="">전체</option>
              {[
                ...new Set(
                  archive.menus.map((m) => m.category).filter(Boolean),
                ),
              ].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            태그
            <select
              value={filters.tag}
              onChange={(e) => update("tag", e.target.value)}
            >
              <option value="">전체</option>
              {archive.tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            시작일
            <input
              type="date"
              value={filters.from}
              onChange={(e) => update("from", e.target.value)}
            />
          </label>
          <label>
            종료일
            <input
              type="date"
              min={filters.from}
              value={filters.to}
              onChange={(e) => update("to", e.target.value)}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={filters.first}
              onChange={(e) => update("first", e.target.checked)}
            />
            처음 먹은 기록만
          </label>
          <button
            className="text-button"
            onClick={() => {
              setFilters(initialFilters);
              setQuery("");
            }}
          >
            필터 초기화
          </button>
        </div>
      )}
    </>
  );
}
export function Collection({
  archive,
  onAdd,
  onDemo,
}: {
  archive: Archive;
  onAdd: Add;
  onDemo: () => void;
}) {
  const [filters, setFilters] = useState(initialFilters),
    [query, setQuery] = useState(""),
    [layout, setLayout] = useState("grid"),
    [sort, setSort] = useState("recent");
  const menus = useMemo(
    () =>
      archive.menus
        .filter((m) => !m.discovered || menuRecords(archive, m.id).length > 0)
        .filter(
          (m) =>
            (!query || searchable(archive, m.id).includes(normalize(query))) &&
            (!filters.verdict ||
              preference(menuRecords(archive, m.id)) === filters.verdict) &&
            (Object.entries(filters).some(
              ([key, value]) => key !== "verdict" && value,
            )
              ? menuRecords(archive, m.id).some((r) =>
                  matchesRecord(archive, r, { ...filters, verdict: "" }),
                )
              : true),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name, "ko")
            : sort === "repeated"
              ? menuRecords(archive, b.id).length -
                menuRecords(archive, a.id).length
              : sort === "first"
                ? (
                    menuRecords(archive, b.id).at(-1)?.eaten_at || ""
                  ).localeCompare(
                    menuRecords(archive, a.id).at(-1)?.eaten_at || "",
                  )
                : (menuRecords(archive, b.id)[0]?.eaten_at || "").localeCompare(
                    menuRecords(archive, a.id)[0]?.eaten_at || "",
                  ),
        ),
    [archive, query, filters, sort],
  );
  return (
    <>
      <PageHeading page="collection">
        <div className="archive-stamp">
          <span>A PRIVATE ARCHIVE</span>
          <span className="stamp-p">P.</span>
          <span>OF EVERYDAY TASTE</span>
        </div>
      </PageHeading>
      {!archive.menus.some(
        (m) => !m.discovered || menuRecords(archive, m.id).length > 0,
      ) ? (
        <section className="welcome">
          <div className="welcome-line">
            <span className="eyebrow">YOUR FIRST PAGE</span>
            <span>001</span>
          </div>
          <div className="welcome-content">
            <div>
              <h2>
                Your taste,
                <br />
                <em>as you remember it.</em>
              </h2>
              <p>
                처음 먹어본 한 접시부터
                <br />
                다시 찾게 되는 익숙한 맛까지.
                <br />
                나의 취향을, 나의 말로 남겨 보세요.
              </p>
              <button className="primary" onClick={() => onAdd()}>
                <Plus size={18} />첫 식사 기록하기
              </button>
              {!archive.brands.length &&
                !archive.places.length &&
                !archive.saved_links.length && (
                  <button className="text-button demo-link" onClick={onDemo}>
                    예시 아카이브 둘러보기 <ArrowUpRight size={16} />
                  </button>
                )}
            </div>
            <div className="welcome-art" aria-hidden="true">
              <div className="large-plate">
                <span>
                  Every meal
                  <br />
                  <em>leaves a trace.</em>
                </span>
              </div>
              <span className="art-caption">A NOTE TO YOUR FUTURE SELF.</span>
            </div>
          </div>
        </section>
      ) : (
        <>
          <FilterBar
            archive={archive}
            filters={filters}
            setFilters={setFilters}
            query={query}
            setQuery={setQuery}
          />
          <div className="collection-toolbar">
            <span className="eyebrow">
              {String(menus.length).padStart(2, "0")} MENU ITEMS{" "}
              <span className="muted">
                / {archive.records.length} EATING RECORDS
              </span>
            </span>
            <div className="sort-controls">
              <select
                aria-label="메뉴 정렬"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="recent">최근 먹은 순</option>
                <option value="first">처음 먹은 순</option>
                <option value="repeated">자주 먹은 순</option>
                <option value="name">이름순</option>
              </select>
              <button
                className={layout === "grid" ? "active" : ""}
                aria-label="격자 보기"
                aria-pressed={layout === "grid"}
                onClick={() => setLayout("grid")}
              >
                <LayoutGrid size={17} />
              </button>
              <button
                className={layout === "list" ? "active" : ""}
                aria-label="목록 보기"
                aria-pressed={layout === "list"}
                onClick={() => setLayout("list")}
              >
                <List size={19} />
              </button>
            </div>
          </div>
          {menus.length ? (
            <div
              className={`menu-grid ${layout === "list" ? "list-layout" : ""}`}
            >
              {menus.map((m, i) => (
                <MenuTile key={m.id} archive={archive} menu={m} index={i} />
              ))}
            </div>
          ) : (
            <Empty
              title="아직 이 기억은 없네요."
              description="검색어나 필터를 바꿔 보세요."
            />
          )}
          <button className="add-another" onClick={() => onAdd()}>
            <Plus size={21} />
            <span>또 하나의 맛을 기록하세요.</span>
            <ArrowUpRight size={21} />
          </button>
        </>
      )}
      <div className="closing-note">
        <span>기억하고 싶은 맛만, 솔직하게.</span>
        <span>NO STARS. JUST YOUR TASTE.</span>
      </div>
    </>
  );
}

export function RecordRow({
  archive,
  record,
  onEdit,
  onDelete,
  showMenu = true,
}: {
  archive: Archive;
  record: EatingRecord;
  onEdit: (r: EatingRecord) => void;
  onDelete: (r: EatingRecord) => void;
  showMenu?: boolean;
}) {
  const menu = archive.menus.find((m) => m.id === record.menu_id),
    place = archive.places.find((p) => p.id === record.place_id),
    photos = archive.photos
      .filter((p) => p.eating_record_id === record.id)
      .sort((a, b) => a.sort_order - b.sort_order),
    tags = archive.record_tags
      .filter((t) => t.eating_record_id === record.id)
      .map((t) => archive.tags.find((x) => x.id === t.tag_id));
  return (
    <article className="record-row">
      <div className="record-date">
        <b>{record.eaten_at.slice(8, 10)}</b>
        <span>{dateLabel(record.eaten_at).slice(3)}</span>
      </div>
      <div className="record-content">
        {showMenu && (
          <a className="record-menu" href={`#/menu/${menu?.id}`}>
            {menu?.name}
            <ArrowUpRight size={16} />
          </a>
        )}
        <div className="record-location">
          {place?.name || "장소 미기록"}
          {record.price_paid !== undefined && (
            <span> · ₩{record.price_paid.toLocaleString("ko-KR")}</span>
          )}
          {record.dining_context && (
            <span>
              {" "}
              ·{" "}
              {
                {
                  DINE_IN: "매장에서",
                  TAKEOUT: "포장",
                  DELIVERY: "배달",
                  HOME: "집에서",
                  OTHER: "기타",
                }[record.dining_context]
              }
            </span>
          )}
        </div>
        <div className="record-verdict">
          <VerdictLabel value={record.verdict} />
          <span>{reorders[record.reorder_intent]}</span>
        </div>
        {record.short_note && (
          <p className="record-note">{record.short_note}</p>
        )}
        {record.detailed_note && (
          <details className="detailed-note">
            <summary>더 남긴 이야기</summary>
            <p>{record.detailed_note}</p>
          </details>
        )}
        {!!photos.length && (
          <div className="record-photos">
            {photos.map((p) => (
              <a
                key={p.id}
                href={p.storage_path}
                download={`${menu?.name || "palate"}-${record.eaten_at}.webp`}
                aria-label={`${menu?.name} 사진 내려받기`}
              >
                <img
                  src={p.storage_path}
                  alt={`${menu?.name} 식사 사진`}
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        )}
        {!!tags.length && (
          <div className="tags">
            {tags.map((t) => (
              <span key={t?.id}>#{t?.name}</span>
            ))}
          </div>
        )}
      </div>
      <div className="record-actions">
        <button
          className="icon-button"
          aria-label={`${menu?.name} ${record.eaten_at} 기록 수정`}
          onClick={() => onEdit(record)}
        >
          <Pencil size={16} />
        </button>
        <button
          className="icon-button"
          aria-label={`${menu?.name} ${record.eaten_at} 기록 삭제`}
          onClick={() => onDelete(record)}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}
export function Journal({
  archive,
  onAdd,
  onEdit,
  onDelete,
}: {
  archive: Archive;
  onAdd: Add;
  onEdit: (r: EatingRecord) => void;
  onDelete: (r: EatingRecord) => void;
}) {
  const [filters, setFilters] = useState(initialFilters),
    [query, setQuery] = useState("");
  const records = archive.records
    .filter(
      (r) =>
        matchesRecord(archive, r, filters) &&
        (!query ||
          normalize(
            [
              archive.menus.find((m) => m.id === r.menu_id)?.name,
              archive.brands.find(
                (b) =>
                  b.id ===
                  archive.menus.find((m) => m.id === r.menu_id)?.brand_id,
              )?.name,
              archive.places.find((p) => p.id === r.place_id)?.name,
              r.short_note,
              r.detailed_note,
              ...archive.record_tags
                .filter((t) => t.eating_record_id === r.id)
                .map((t) => archive.tags.find((x) => x.id === t.tag_id)?.name),
            ].join(" "),
          ).includes(normalize(query))),
    )
    .sort(
      (a, b) =>
        b.eaten_at.localeCompare(a.eaten_at) ||
        b.created_at.localeCompare(a.created_at),
    );
  const months = [...new Set(records.map((r) => r.eaten_at.slice(0, 7)))];
  return (
    <>
      <PageHeading page="journal">
        <button className="text-button" onClick={() => onAdd()}>
          <Plus size={17} />
          오늘의 한 끼
        </button>
      </PageHeading>
      <FilterBar
        archive={archive}
        filters={filters}
        setFilters={setFilters}
        query={query}
        setQuery={setQuery}
      />
      {!records.length ? (
        <Empty
          title="한 끼의 기억을 남겨 주세요."
          description={
            archive.records.length
              ? "검색어나 필터를 바꿔 보세요."
              : "오늘의 맛은 어땠나요?"
          }
          onAdd={!archive.records.length ? () => onAdd() : undefined}
        />
      ) : (
        <div className="journal">
          {months.map((month) => (
            <section key={month}>
              <div className="month-title">
                <h2>
                  {new Intl.DateTimeFormat("en-US", {
                    month: "long",
                    year: "numeric",
                  }).format(new Date(`${month}-01T12:00:00`))}
                </h2>
                <span className="eyebrow">
                  {records.filter((r) => r.eaten_at.startsWith(month)).length}{" "}
                  ENTRIES
                </span>
              </div>
              {records
                .filter((r) => r.eaten_at.startsWith(month))
                .map((r) => (
                  <RecordRow
                    archive={archive}
                    record={r}
                    key={r.id}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
export function MenuDetail({
  archive,
  menuId,
  onAdd,
  onEdit,
  onDelete,
  onUpdate,
}: {
  archive: Archive;
  menuId: string;
  onAdd: Add;
  onEdit: (r: EatingRecord) => void;
  onDelete: (r: EatingRecord) => void;
  onUpdate: (fn: (a: Archive) => Archive) => boolean;
}) {
  const menu = archive.menus.find((m) => m.id === menuId),
    [edit, setEdit] = useState(false),
    [name, setName] = useState(menu?.name || ""),
    [category, setCategory] = useState(menu?.category || ""),
    [brandName, setBrandName] = useState(
      archive.brands.find((b) => b.id === menu?.brand_id)?.name || "",
    );
  if (!menu)
    return (
      <Empty
        title="메뉴를 찾을 수 없습니다."
        description="컬렉션에서 다른 메뉴를 찾아보세요."
      />
    );
  const rs = menuRecords(archive, menu.id),
    v = preference(rs);
  return (
    <>
      <a className="back-link" href="#/collection">
        <ArrowLeft size={16} />
        COLLECTION
      </a>
      <div className="menu-detail">
        <MenuCover
          archive={archive}
          menu={menu}
          index={archive.menus.indexOf(menu)}
          large
        />
        <div className="menu-intro">
          <div className="eyebrow">
            {archive.brands.find((b) => b.id === menu.brand_id)?.name ||
              "MY MENU"}{" "}
            / {menu.category || "UNCATEGORIZED"}
          </div>
          <h1>{menu.name}</h1>
          <p className="detail-subtitle">같은 메뉴, 매번 다른 기억.</p>
          <div className="detail-verdict">
            {v && <VerdictLabel value={v} />}
            <span>
              {rs.filter((r) => r.verdict === "LIKE").length} / {rs.length}{" "}
              LIKED
            </span>
          </div>
          <div className="detail-stats">
            <div>
              <strong>{rs.length}</strong>
              <span>TIMES EATEN</span>
            </div>
            <div>
              <span>FIRST</span>
              <b>{rs.at(-1) ? dateLabel(rs.at(-1)!.eaten_at) : "—"}</b>
              <span>LAST</span>
              <b>{rs[0] ? dateLabel(rs[0].eaten_at) : "—"}</b>
            </div>
          </div>
          <button className="primary" onClick={() => onAdd(menu.id)}>
            <Plus size={18} />
            {rs.length ? "다시 먹은 기록" : "먹은 기록 남기기"}
          </button>
          <WantButton
            archive={archive}
            type="MENU"
            targetId={menu.id}
            onSave={onUpdate}
          />
          <button className="text-button" onClick={() => setEdit(!edit)}>
            <Pencil size={15} />
            메뉴 정보 수정
          </button>
          {edit && (
            <form
              className="menu-edit"
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  onUpdate((a) =>
                    updateMenuInfo(a, menu.id, name, category, brandName),
                  )
                )
                  setEdit(false);
              }}
            >
              <label className="field">
                <span>메뉴 이름</span>
                <input
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="field">
                <span>브랜드</span>
                <input
                  list="menu-brands"
                  maxLength={200}
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="없으면 비워 두세요"
                />
                <datalist id="menu-brands">
                  {archive.brands.map((b) => (
                    <option key={b.id} value={b.name} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span>음식 종류</span>
                <input
                  maxLength={100}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={isFavourite(archive, menu.id)}
                  onChange={(e) =>
                    onUpdate((a) => ({
                      ...a,
                      menus: a.menus.map((m) =>
                        m.id === menu.id
                          ? { ...m, favourite_override: e.target.checked }
                          : m,
                      ),
                    }))
                  }
                />
                자주 찾는 취향 라벨
              </label>
              <button className="text-button">
                정보 저장 <ArrowUpRight size={16} />
              </button>
            </form>
          )}
        </div>
      </div>
      <section className="history">
        <div className="section-heading">
          <h2>
            Eating history<span>모든 식사의 기록</span>
          </h2>
          <span className="eyebrow">{rs.length} ENTRIES</span>
        </div>
        {rs.length > 0 && (
          <div className="preference-summary">
            <div>
              <span className="eyebrow">LIFETIME / 전체 기록</span>
              <div className="verdict-counts">
                {(Object.keys(verdicts) as Verdict[]).map((v) => (
                  <span key={v}>
                    <VerdictLabel value={v} />
                    <b>{rs.filter((r) => r.verdict === v).length}</b>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span className="eyebrow">RECENT / 최근 3회</span>
              <div className="verdict-counts">
                {rs.slice(0, 3).map((r) => (
                  <span key={r.id}>
                    <VerdictLabel value={r.verdict} />
                    <small>{r.eaten_at.slice(5).replace("-", ".")}</small>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
        {rs.length ? (
          rs.map((r) => (
            <RecordRow
              key={r.id}
              archive={archive}
              record={r}
              onEdit={onEdit}
              onDelete={onDelete}
              showMenu={false}
            />
          ))
        ) : (
          <Empty
            title="첫 식사를 기다리는 메뉴."
            description="메뉴는 기록을 지워도 남아 있습니다."
            onAdd={() => onAdd(menu.id)}
          />
        )}
      </section>
    </>
  );
}

export function Places({
  archive,
  selectedId,
  onUpdate,
  onDeletePlace,
}: {
  archive: Archive;
  selectedId?: string;
  onUpdate: (fn: (a: Archive) => Archive) => boolean;
  onDeletePlace: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [edit, setEdit] = useState(false);
  const brand = archive.brands.find((b) => b.id === selectedId),
    place = archive.places.find((p) => p.id === selectedId),
    [name, setName] = useState(brand?.name || place?.name || ""),
    [address, setAddress] = useState(place?.address || "");
  const list = archive.places.filter(
    (p) =>
      !query ||
      normalize(
        p.name +
          archive.brands.find((b) => b.id === p.brand_id)?.name +
          p.address,
      ).includes(normalize(query)),
  );
  const records = selectedId
    ? archive.records.filter((r) =>
        place
          ? r.place_id === place.id
          : archive.places.some(
              (p) => p.id === r.place_id && p.brand_id === brand?.id,
            ),
      )
    : [];
  const menus = archive.menus.filter(
    (m) =>
      records.some((r) => r.menu_id === m.id) ||
      (brand && m.brand_id === brand.id),
  );
  return (
    <>
      {selectedId && (brand || place) ? (
        <>
          <a href="#/places" className="back-link">
            <ArrowLeft size={16} />
            PLACES
          </a>
          <header className="page-heading">
            <div>
              <span className="eyebrow">{brand ? "BRAND" : "PLACE"}</span>
              <h1>{brand?.name || place?.name}</h1>
              <p>{place?.address || "이곳에서 모은 취향들."}</p>
              <div className="place-counts">
                {menus.length}개의 메뉴 <span> / </span>
                {records.length}번의 식사
              </div>
            </div>
            <button className="text-button" onClick={() => setEdit(!edit)}>
              <Pencil size={16} />
              정보 수정
            </button>
          </header>
          {edit && (
            <form
              className="place-edit"
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  onUpdate((a) =>
                    brand
                      ? {
                          ...a,
                          brands: a.brands.map((b) =>
                            b.id === brand.id
                              ? {
                                  ...b,
                                  name: name.trim(),
                                  normalized_name: normalize(name),
                                }
                              : b,
                          ),
                        }
                      : {
                          ...a,
                          places: a.places.map((p) =>
                            p.id === place?.id
                              ? {
                                  ...p,
                                  name: name.trim(),
                                  normalized_name: normalize(name),
                                  address,
                                }
                              : p,
                          ),
                        },
                  )
                )
                  setEdit(false);
              }}
            >
              <label className="field">
                <span>이름</span>
                <input
                  maxLength={200}
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {place && (
                <label className="field">
                  <span>주소</span>
                  <input
                    value={address}
                    maxLength={2000}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </label>
              )}
              <button className="primary">변경 저장</button>
              {place && (
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => onDeletePlace(place.id)}
                >
                  장소 삭제
                </button>
              )}
            </form>
          )}
          {brand && (
            <div className="brand-places">
              {archive.places
                .filter((p) => p.brand_id === brand.id)
                .map((p) => (
                  <a key={p.id} href={`#/places/${p.id}`}>
                    {p.name}
                    <ArrowUpRight size={15} />
                  </a>
                ))}
            </div>
          )}
          <div className="section-heading">
            <h2>
              On the menu<span>이곳에서 먹은 메뉴</span>
            </h2>
          </div>
          {menus.length ? (
            <div className="menu-grid">
              {menus.map((m, i) => (
                <MenuTile key={m.id} archive={archive} menu={m} index={i} />
              ))}
            </div>
          ) : (
            <Empty
              title="아직 메뉴가 없습니다."
              description="식사 기록을 남기면 이곳에 모입니다."
            />
          )}
        </>
      ) : (
        <>
          <PageHeading page="places" />
          <label className="place-search search-input">
            <Search size={18} />
            <input
              value={query}
              placeholder="브랜드, 장소, 동네 찾기"
              aria-label="장소 검색"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {!archive.places.length ? (
            <Empty
              title="맛을 만난 곳을 모아 보세요."
              description="식사를 기록할 때 장소와 브랜드를 함께 추가할 수 있습니다."
            />
          ) : (
            <>
              <div className="section-heading">
                <h2>
                  Brands<span>익숙한 이름들</span>
                </h2>
                <span className="eyebrow">{archive.brands.length} BRANDS</span>
              </div>
              <div className="brand-list">
                {archive.brands
                  .filter(
                    (b) =>
                      !query || normalize(b.name).includes(normalize(query)),
                  )
                  .map((b, i) => (
                    <a href={`#/places/${b.id}`} key={b.id}>
                      <span className="brand-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <strong>{b.name}</strong>
                      <span>
                        {
                          archive.menus.filter((m) => m.brand_id === b.id)
                            .length
                        }{" "}
                        MENU
                      </span>
                      <ArrowUpRight size={20} />
                    </a>
                  ))}
              </div>
              <div className="section-heading">
                <h2>
                  Places<span>기억이 남은 자리</span>
                </h2>
                <span className="eyebrow">{list.length} PLACES</span>
              </div>
              <div className="places-list">
                {list.map((p) => {
                  const rs = archive.records.filter((r) => r.place_id === p.id);
                  return (
                    <a href={`#/places/${p.id}`} key={p.id}>
                      <div>
                        <h3>{p.name}</h3>
                        <p>
                          {p.address ||
                            archive.brands.find((b) => b.id === p.brand_id)
                              ?.name ||
                            "주소 미기록"}
                        </p>
                      </div>
                      <span>
                        {new Set(rs.map((r) => r.menu_id)).size}개의 메뉴{" "}
                        <small>{rs.length}번의 식사</small>
                      </span>
                      <ArrowUpRight size={20} />
                    </a>
                  );
                })}
              </div>
              {!list.length && (
                <Empty
                  title="일치하는 장소가 없습니다."
                  description="다른 이름이나 동네로 찾아보세요."
                />
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

export function Insights({ archive }: { archive: Archive }) {
  const sorted = archive.menus
    .map((m) => ({ menu: m, rs: menuRecords(archive, m.id) }))
    .filter((x) => x.rs.length)
    .sort((a, b) => b.rs.length - a.rs.length);
  const consistent = sorted
    .filter((x) => x.rs.length >= 3)
    .sort(
      (a, b) =>
        b.rs.filter((r) => r.verdict === "LIKE").length / b.rs.length -
        a.rs.filter((r) => r.verdict === "LIKE").length / a.rs.length,
    );
  const notForMe = sorted
    .filter((x) =>
      x.rs.some((r) => r.verdict === "DISLIKE" && r.reorder_intent === "NO"),
    )
    .sort(
      (a, b) =>
        b.rs.filter((r) => r.verdict === "DISLIKE" && r.reorder_intent === "NO")
          .length /
          b.rs.length -
        a.rs.filter((r) => r.verdict === "DISLIKE" && r.reorder_intent === "NO")
          .length /
          a.rs.length,
    );
  const categories = [
    ...new Set(archive.menus.map((m) => m.category).filter(Boolean)),
  ] as string[];
  const statList = (items: typeof sorted, mode: string) => (
    <ol className="insight-list">
      {items.slice(0, 5).map((x, i) => (
        <li key={x.menu.id}>
          <a href={`#/menu/${x.menu.id}`}>
            <span className="muted">{String(i + 1).padStart(2, "0")}</span>
            <span>{x.menu.name}</span>
            <strong>
              {mode === "repeat"
                ? `${x.rs.length}회`
                : mode === "liked"
                  ? `${Math.round((x.rs.filter((r) => r.verdict === "LIKE").length / x.rs.length) * 100)}%`
                  : `${Math.round((x.rs.filter((r) => r.verdict === "DISLIKE" && r.reorder_intent === "NO").length / x.rs.length) * 100)}%`}
            </strong>
            <ArrowUpRight size={16} />
          </a>
        </li>
      ))}
    </ol>
  );
  return (
    <>
      <PageHeading page="insights" />
      {!archive.records.length ? (
        <Empty
          title="취향은 한 끼씩 쌓입니다."
          description="기록을 남기면 자주 찾는 메뉴와 음식 종류별 취향을 볼 수 있습니다."
        />
      ) : (
        <>
          <div className="taste-totals">
            {[
              [archive.records.length, "EATING RECORDS", "번의 식사"],
              [sorted.length, "MENUS TRIED", "개의 메뉴"],
              [
                new Set(archive.records.map((r) => r.place_id).filter(Boolean))
                  .size,
                "PLACES VISITED",
                "곳의 장소",
              ],
            ].map(([n, label, ko]) => (
              <div key={label}>
                <strong>{n}</strong>
                <span>{label}</span>
                <small>{ko}</small>
              </div>
            ))}
          </div>
          <div className="insight-columns">
            <section>
              <div className="section-heading">
                <h2>
                  On repeat<span>자꾸만 손이 가는 맛</span>
                </h2>
              </div>
              {statList(sorted, "repeat")}
            </section>
            <section>
              <div className="section-heading">
                <h2>
                  Always a pleasure<span>한결같이 좋았던 맛</span>
                </h2>
              </div>
              {consistent.length ? (
                statList(consistent, "liked")
              ) : (
                <p className="insight-empty">
                  같은 메뉴를 세 번 이상 먹으면
                  <br />
                  한결같은 취향을 발견할 수 있어요.
                </p>
              )}
              <p className="micro">3회 이상 기록한 메뉴 · 호 비율</p>
            </section>
          </div>
          <div className="insight-columns">
            <section>
              <div className="section-heading">
                <h2>
                  Taste by category<span>종류마다 다른 취향</span>
                </h2>
              </div>
              {categories.length ? (
                categories.map((c) => {
                  const rs = archive.records.filter(
                    (r) =>
                      archive.menus.find((m) => m.id === r.menu_id)
                        ?.category === c,
                  );
                  const percent = rs.length
                    ? Math.round(
                        (rs.filter((r) => r.verdict === "LIKE").length /
                          rs.length) *
                          100,
                      )
                    : 0;
                  return (
                    <div className="category-bar" key={c}>
                      <div>
                        <span>{c}</span>
                        <small>
                          {rs.length}회 기록 · 호 {percent}%
                        </small>
                      </div>
                      <div className="bar-track">
                        <span style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="insight-empty">
                  메뉴에 음식 종류를 추가해 보세요.
                </p>
              )}
            </section>
            <section>
              <div className="section-heading">
                <h2>
                  Not for me<span>나와는 조금 달랐던 맛</span>
                </h2>
              </div>
              {notForMe.length ? (
                statList(notForMe, "disliked")
              ) : (
                <p className="insight-empty">
                  아직은 없네요.
                  <br />
                  좋고 싫음, 모두 소중한 취향입니다.
                </p>
              )}
              <p className="micro">불호이면서 재주문 의사가 없는 기록의 비율</p>
            </section>
          </div>
          <section>
            <div className="section-heading">
              <h2>
                Changing tastes<span>시간에 따라 달라지는 입맛</span>
              </h2>
            </div>
            <div className="period-table">
              <div className="period-table-head">
                <span>PERIOD</span>
                <span>EATING RECORDS</span>
                <span>LIKED</span>
              </div>
              {[
                ...new Set(
                  archive.records.map(
                    (r) =>
                      `${r.eaten_at.slice(0, 4)} ${Number(r.eaten_at.slice(5, 7)) <= 6 ? "H1" : "H2"}`,
                  ),
                ),
              ]
                .sort()
                .reverse()
                .map((period) => {
                  const rs = archive.records.filter(
                    (r) =>
                      `${r.eaten_at.slice(0, 4)} ${Number(r.eaten_at.slice(5, 7)) <= 6 ? "H1" : "H2"}` ===
                      period,
                  );
                  return (
                    <div key={period}>
                      <span>
                        {period.replace("H1", "상반기").replace("H2", "하반기")}
                      </span>
                      <span>{rs.length}</span>
                      <span>
                        {Math.round(
                          (rs.filter((r) => r.verdict === "LIKE").length /
                            rs.length) *
                            100,
                        )}
                        %
                      </span>
                    </div>
                  );
                })}
            </div>
            <p className="micro">
              각 기간의 실제 기록을 비교합니다. 표본 수에 따라 비율은
              달라집니다.
            </p>
          </section>
        </>
      )}
    </>
  );
}
