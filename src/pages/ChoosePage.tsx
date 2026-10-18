import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronRight,
  ExternalLink,
  Link as LinkIcon,
  Play,
  Plus,
  Search,
  Smartphone,
  Trash2,
  RefreshCw,
  Pencil,
} from "lucide-react";
import type { Archive, LinkTarget, SavedLink } from "../types/model";
import { menuRecords, normalize, preference } from "../lib/data";
import {
  addCatalog,
  addMenuToVenue,
  applyRestaurantDetails,
  isWanted,
  saveSharedLink,
  venueMenus,
  venueTitle,
  type CatalogBrand,
} from "../lib/discovery";
import franchises from "../data/franchises.json";
import { defaultEndpoint, restaurantProvider } from "../lib/restaurants";
import { sourceOf, sharedUrl } from "../lib/urls";
import { dateLabel, Empty, Modal, VerdictLabel } from "../components/Common";
import {
  LinkEditor,
  PasteLink,
  ShortcutGuide,
  WantButton,
  type Commit,
} from "../components/DiscoveryCommon";
import AddPlace from "../components/AddPlace";

interface Props {
  archive: Archive;
  path: string[];
  params: URLSearchParams;
  onSave: Commit;
  onAdd: (menuId?: string, placeId?: string) => void;
  onSettings: () => void;
}
const endpoint = (a: Archive) =>
  a.preferences.restaurant_endpoint || defaultEndpoint();
const titleFor = (a: Archive, target: LinkTarget) =>
  target.type === "BRAND"
    ? a.brands.find((x) => x.id === target.id)
    : a.places.find((x) => x.id === target.id);

export default function ChoosePage({
  archive,
  path,
  params,
  onSave,
  onAdd,
  onSettings,
}: Props) {
  const view = path[1] || "places",
    target =
      path[2] && (view === "brand" || view === "place")
        ? ({
            type: view === "brand" ? "BRAND" : "PLACE",
            id: path[2],
          } as LinkTarget)
        : undefined;
  const [addPlace, setAddPlace] = useState<{ linkId?: string }>(),
    [paste, setPaste] = useState(false),
    [shortcut, setShortcut] = useState(false),
    [editLink, setEditLink] = useState<string>(),
    [deleteLink, setDeleteLink] = useState<SavedLink>(),
    [query, setQuery] = useState(""),
    [wanted, setWanted] = useState(false),
    [linkFilter, setLinkFilter] = useState("all");
  const venues: LinkTarget[] = [
    ...archive.places.map((p) => ({ type: "PLACE" as const, id: p.id })),
    ...archive.brands.map((b) => ({ type: "BRAND" as const, id: b.id })),
  ];
  const visibleVenues = venues.filter((t) => {
    const v = titleFor(archive, t)!;
    const menus = venueMenus(archive, t);
    return (
      (!query ||
        normalize(v.name + ("address" in v ? v.address || "" : "")).includes(
          normalize(query),
        )) &&
      (!wanted ||
        isWanted(archive, t.type, t.id) ||
        menus.some((m) => isWanted(archive, "MENU", m.id)))
    );
  });
  const catalogs = (franchises.brands as CatalogBrand[]).filter(
    (b) => !query || normalize(b.name + b.category).includes(normalize(query)),
  );
  const links = archive.saved_links.filter(
    (l) =>
      (!query ||
        normalize(
          l.title +
            l.note +
            l.url +
            l.targets.map((t) => venueTitle(archive, t)).join(),
        ).includes(normalize(query))) &&
      (linkFilter === "all" ||
        (linkFilter === "inbox"
          ? !l.targets.length
          : linkFilter === "linked"
            ? !!l.targets.length
            : l.kind === "REEL")),
  );
  function openCatalog(catalog: CatalogBrand) {
    let brandId = "";
    if (
      onSave((a) => {
        const saved = addCatalog(a, catalog);
        brandId = saved.brandId;
        return saved.archive;
      })
    )
      location.hash = `/choose/brand/${brandId}`;
  }
  return (
    <>
      {!target && (
        <header className="page-heading choose-heading">
          <div>
            <h1>오늘은, 무엇을 먹을까.</h1>
          </div>
          <button className="primary" onClick={() => setAddPlace({})}>
            <Plus size={17} />
            음식점 추가
          </button>
        </header>
      )}
      {!target && (
        <nav className="discovery-nav" aria-label="고르기 안의 메뉴">
          {[
            ["places", "내 음식점"],
            ["franchises", "프랜차이즈"],
            ["reels", "릴스 보관함"],
          ].map(([key, label]) => (
            <a
              key={key}
              href={`#/choose/${key === "places" ? "" : key}`}
              className={view === key ? "active" : ""}
              aria-current={view === key ? "page" : undefined}
            >
              {label}
              {key === "reels" && !!archive.saved_links.length && (
                <small>{archive.saved_links.length}</small>
              )}
            </a>
          ))}
        </nav>
      )}
      {target ? (
        <VenueDetail
          key={target.type + target.id}
          archive={archive}
          target={target}
          onSave={onSave}
          onAdd={onAdd}
          onSettings={onSettings}
          onEditLink={setEditLink}
        />
      ) : (
        <>
          <div className="choose-tools">
            <label className="search-input">
              <Search size={17} />
              <input
                aria-label={
                  view === "reels" ? "보관한 링크 검색" : "음식점과 브랜드 검색"
                }
                placeholder={
                  view === "reels"
                    ? "저장한 이름, 메모, 연결한 곳"
                    : "이름, 동네, 브랜드 찾기"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {view === "places" ? (
              <>
                <button
                  className={`want-filter ${wanted ? "active" : ""}`}
                  aria-pressed={wanted}
                  aria-label="가고 싶은 곳과 메뉴만 보기"
                  onClick={() => setWanted(!wanted)}
                >
                  <Bookmark size={18} />
                  <span>가고 싶은 곳과 메뉴</span>
                </button>
                <button
                  className="primary tools-add"
                  aria-label="음식점 추가"
                  onClick={() => setAddPlace({})}
                >
                  <Plus size={18} />
                  추가
                </button>
              </>
            ) : view === "reels" ? (
              <button className="text-button" onClick={() => setPaste(true)}>
                <Plus size={16} />
                링크 저장
              </button>
            ) : (
              <span className="section-count">브랜드 {catalogs.length}</span>
            )}
          </div>
          {view === "places" && (
            <>
              {visibleVenues.length ? (
                <div className="venue-list">
                  {visibleVenues.map((t) => {
                    const v = titleFor(archive, t)!,
                      menus = venueMenus(archive, t),
                      tried = menus.filter(
                        (m) => menuRecords(archive, m.id).length > 0,
                      ).length,
                      wishes = menus.filter((m) =>
                        isWanted(archive, "MENU", m.id),
                      ).length;
                    return (
                      <article key={t.type + t.id} className="venue-row">
                        <a
                          className="venue-main"
                          href={`#/choose/${t.type === "BRAND" ? "brand" : "place"}/${t.id}`}
                        >
                          <span className="venue-letter" aria-hidden="true">
                            {v.name.slice(0, 1)}
                          </span>
                          <span className="venue-text">
                            <h2>{v.name}</h2>
                            <span className="venue-summary">
                              {[
                                t.type === "BRAND" && "브랜드",
                                `메뉴 ${menus.length}`,
                                `먹어봄 ${tried}`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                              {wishes > 0 && (
                                <span className="liked-text">
                                  {" "}
                                  · 먹고 싶은 {wishes}
                                </span>
                              )}
                            </span>
                          </span>
                        </a>
                        <WantButton
                          archive={archive}
                          type={t.type}
                          targetId={t.id}
                          onSave={onSave}
                          place
                          compact
                          name={v.name}
                        />
                      </article>
                    );
                  })}
                </div>
              ) : (
                <Empty
                  title={
                    wanted
                      ? "아직 표시해 둔 곳이 없네요."
                      : "다음 한 끼의 후보를 모아 보세요."
                  }
                  description={
                    wanted
                      ? "음식점이나 메뉴에 가고 싶은 마음을 표시해 두세요."
                      : "음식점 이름으로 찾거나 프랜차이즈 메뉴부터 둘러볼 수 있습니다."
                  }
                />
              )}
            </>
          )}
          {view === "franchises" && (
            <>
              <div className="catalog-intro">
                <span>브랜드를 고르면 수록된 메뉴가 내 목록에 펼쳐집니다.</span>
                <small>
                  수록 기준 {franchises.version.replaceAll("-", ".")} · 가격과
                  판매 여부는 매장에서 확인해 주세요.
                </small>
              </div>
              <div className="franchise-grid">
                {catalogs.map((b, i) => {
                  const saved = archive.brands.find(
                    (x) =>
                      x.catalog_key === b.key ||
                      x.normalized_name === normalize(b.name),
                  );
                  return (
                    <article key={b.key} className="franchise-tile">
                      <div className="franchise-top">
                        <span className="eyebrow">{b.category}</span>
                        <span>{String(i + 1).padStart(2, "0")}</span>
                      </div>
                      <h2>{b.name}</h2>
                      <p>{b.menus.slice(0, 3).join(" · ")}</p>
                      <div className="franchise-bottom">
                        <span>{b.menus.length}개의 수록 메뉴</span>
                        <button
                          className="text-button"
                          onClick={() => openCatalog(b)}
                        >
                          {saved ? "메뉴 보기" : "메뉴 불러오기"}
                          <ArrowUpRight size={17} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {!catalogs.length && (
                <Empty
                  title="일치하는 브랜드가 없습니다."
                  description="다른 이름으로 찾거나 음식점을 직접 추가할 수 있습니다."
                />
              )}
            </>
          )}
          {view === "reels" && (
            <>
              {params.get("received") && (
                <div className="received-notice" role="status">
                  <Check size={17} />
                  {params.get("received") === "existing"
                    ? "이미 보관한 링크입니다. 중복으로 추가하지 않았어요."
                    : "공유한 링크를 보관했습니다. 정리는 나중에 해도 괜찮아요."}
                </div>
              )}
              <div className="inbox-toolbar">
                <div className="inbox-filters">
                  {[
                    ["all", "전체"],
                    ["inbox", "아직 정리 전"],
                    ["linked", "연결한 링크"],
                    ["reels", "릴스만"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      className={linkFilter === key ? "active" : ""}
                      aria-pressed={linkFilter === key}
                      onClick={() => setLinkFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="section-count">링크 {links.length}</span>
              </div>
              {links.length ? (
                <div className="saved-link-grid">
                  {links.map((l, i) => (
                    <article
                      className={`saved-link ${params.get("link") === l.id ? "received-link" : ""}`}
                      key={l.id}
                    >
                      <div className="link-cover">
                        <span className="eyebrow">
                          {sourceOf(l.url) === "INSTAGRAM"
                            ? "인스타그램 릴스"
                            : sourceOf(l.url) === "NAVER"
                              ? "네이버 플레이스"
                              : sourceOf(l.url) === "BAEMIN"
                                ? "배민"
                                : "저장한 장소"}
                        </span>
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${l.title} 원본 열기`}
                        >
                          <span className="link-cover-symbol">
                            {l.kind === "REEL" ? (
                              <Play size={28} strokeWidth={1} />
                            ) : (
                              <LinkIcon size={28} strokeWidth={1} />
                            )}
                          </span>
                          <h2>{l.title}</h2>
                          <span className="link-cover-bottom">
                            {dateLabel(l.created_at)}
                            <ArrowUpRight size={20} />
                          </span>
                        </a>
                      </div>
                      {l.note && <p className="saved-link-note">{l.note}</p>}
                      <div className="link-connections">
                        {l.targets.length ? (
                          l.targets.map((t) => (
                            <a
                              key={t.type + t.id}
                              href={
                                t.type === "MENU"
                                  ? `#/menu/${t.id}`
                                  : `#/choose/${t.type === "BRAND" ? "brand" : "place"}/${t.id}`
                              }
                            >
                              {venueTitle(archive, t)}
                              <ChevronRight size={12} />
                            </a>
                          ))
                        ) : (
                          <span>아직 연결하지 않은 발견</span>
                        )}
                      </div>
                      <div className="link-actions">
                        <button
                          className="text-button"
                          onClick={() => setEditLink(l.id)}
                        >
                          <Pencil size={14} />
                          이름·메모·연결
                        </button>
                        {l.kind === "PLACE" && (
                          <button
                            className="text-button"
                            onClick={() => setAddPlace({ linkId: l.id })}
                          >
                            음식점으로 정리 <ArrowUpRight size={13} />
                          </button>
                        )}
                        <button
                          className="icon-button"
                          aria-label={`${l.title} 보관한 링크 삭제`}
                          onClick={() => setDeleteLink(l)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  title="눈길이 갔던 맛을 모아 두세요."
                  description="인스타그램에서 공유하거나 링크를 붙여넣으면 이곳에 남습니다."
                />
              )}
              <button
                className="text-button shortcut-entry"
                onClick={() => setShortcut(true)}
              >
                <Smartphone size={18} />
                아이폰 공유 설정
              </button>
            </>
          )}
        </>
      )}
      {addPlace && (
        <AddPlace
          archive={archive}
          onSave={onSave}
          onClose={() => setAddPlace(undefined)}
          initialLinkId={addPlace.linkId}
        />
      )}
      {paste && <PasteLink onSave={onSave} onClose={() => setPaste(false)} />}
      {shortcut && <ShortcutGuide onClose={() => setShortcut(false)} />}
      {editLink && (
        <LinkEditor
          archive={archive}
          linkId={editLink}
          onSave={onSave}
          onClose={() => setEditLink(undefined)}
        />
      )}
      {deleteLink && (
        <Modal
          title="REMOVE A SAVED LINK"
          onClose={() => setDeleteLink(undefined)}
        >
          <div className="confirm-content">
            <h2>이 발견을 보관함에서 지울까요?</h2>
            <p>
              “{deleteLink.title}”의 링크와 메모를 삭제합니다. 연결한
              음식점·메뉴와 식사 기록은 그대로 남습니다.
            </p>
            <div className="button-row">
              <button
                className="danger-button"
                onClick={() => {
                  if (
                    onSave((a) => ({
                      ...a,
                      saved_links: a.saved_links.filter(
                        (l) => l.id !== deleteLink.id,
                      ),
                    }))
                  )
                    setDeleteLink(undefined);
                }}
              >
                링크 삭제
              </button>
              <button
                className="text-button"
                onClick={() => setDeleteLink(undefined)}
              >
                취소
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function VenueDetail({
  archive,
  target,
  onSave,
  onAdd,
  onSettings,
  onEditLink,
}: {
  archive: Archive;
  target: LinkTarget;
  onSave: Commit;
  onAdd: Props["onAdd"];
  onSettings: () => void;
  onEditLink: (id: string) => void;
}) {
  const venue = titleFor(archive, target),
    menus = venueMenus(archive, target),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [adding, setAdding] = useState(false),
    [menuName, setMenuName] = useState(""),
    [category, setCategory] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(false),
    controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  if (!venue)
    return (
      <Empty
        title="이 음식점은 아직 목록에 없습니다."
        description="고르기 탭에서 음식점을 저장해 주세요."
      />
    );
  const place =
      target.type === "PLACE"
        ? archive.places.find((p) => p.id === target.id)
        : undefined,
    brand =
      target.type === "BRAND"
        ? archive.brands.find((b) => b.id === target.id)
        : undefined;
  const visible = menus.filter(
    (m) =>
      (!query || normalize(m.name + m.category).includes(normalize(query))) &&
      (filter === "all" ||
        (filter === "wanted" && isWanted(archive, "MENU", m.id)) ||
        (filter === "untried" && !menuRecords(archive, m.id).length) ||
        preference(menuRecords(archive, m.id)) === filter),
  );
  const related = archive.saved_links.filter((l) =>
    l.targets.some(
      (t) =>
        (t.type === target.type && t.id === target.id) ||
        (t.type === "MENU" && menus.some((m) => m.id === t.id)),
    ),
  );
  async function refresh() {
    if (!place?.source_url) return;
    setNotice("");
    if (!endpoint(archive)) {
      setNotice(
        "이 음식점의 자동 메뉴 연결이 준비되지 않았습니다. 음식점 정보 연결을 설정한 뒤 다시 불러올 수 있습니다.",
      );
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      const details = await restaurantProvider(endpoint(archive)).details(
        place.source_url,
        abort.signal,
      );
      if (details.menus.length) {
        if (onSave((a) => applyRestaurantDetails(a, place.id, details)))
          setNotice(`메뉴 ${details.menus.length}개의 정보를 확인했습니다.`);
      } else
        setNotice(
          "출처에서 읽을 수 있는 메뉴 목록을 제공하지 않았습니다. 기존 메뉴와 기록은 유지됩니다.",
        );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNotice((e as Error).message);
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }
  return (
    <>
      <a className="back-link" href="#/choose">
        <ArrowLeft size={20} />
        고르기
      </a>
      <header className="venue-heading">
        <div>
          <span className="eyebrow">
            {target.type === "BRAND" ? "브랜드" : "음식점"}
          </span>
          <h1>{venue.name}</h1>
          <p>{place?.address || "끌리는 메뉴와, 먹어본 기억을 한눈에."}</p>
          <div className="venue-summary">
            <span>{menus.length}개의 메뉴</span>
            <span>
              먹어본 메뉴{" "}
              {
                menus.filter((m) => menuRecords(archive, m.id).length > 0)
                  .length
              }
            </span>
            <span className="liked-text">
              먹고 싶은 메뉴{" "}
              {menus.filter((m) => isWanted(archive, "MENU", m.id)).length}
            </span>
          </div>
        </div>
        <WantButton
          archive={archive}
          type={target.type}
          targetId={target.id}
          onSave={onSave}
          place
        />
      </header>
      <div className="menu-source-row">
        <span>
          {brand?.catalog_key
            ? `수록 메뉴 · ${franchises.version.replaceAll("-", ".")}`
            : place?.menus_checked_at
              ? `메뉴 확인 · ${dateLabel(place.menus_checked_at)}`
              : "나의 메뉴 목록"}
        </span>
        <div>
          {venue.source_url && (
            <a
              className="text-button"
              href={venue.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              원문에서 확인 <ExternalLink size={13} />
            </a>
          )}
          {place?.source_url && (
            <button
              className="text-button"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <RefreshCw size={13} />
              {loading ? "확인 중…" : "메뉴 불러오기"}
            </button>
          )}
          <button className="text-button" onClick={() => setAdding(!adding)}>
            <Plus size={15} />
            메뉴 추가
          </button>
        </div>
      </div>
      {notice && (
        <div className="inline-notice" role="status">
          <p>{notice}</p>
          {!endpoint(archive) && (
            <button className="text-button" onClick={onSettings}>
              음식점 정보 연결 설정 <ArrowUpRight size={14} />
            </button>
          )}
        </div>
      )}
      {adding && (
        <form
          className="add-menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              onSave(
                (a) => addMenuToVenue(a, target, menuName, category).archive,
              )
            ) {
              setMenuName("");
              setCategory("");
              setAdding(false);
            }
          }}
        >
          <label className="field">
            <span>추가할 메뉴 이름</span>
            <input
              required
              maxLength={200}
              autoFocus
              value={menuName}
              onChange={(e) => setMenuName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>
              음식 종류 <small>선택</small>
            </span>
            <input
              maxLength={100}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </label>
          <button className="primary">메뉴 저장</button>
        </form>
      )}
      <div className="menu-choice-tools">
        <div className="menu-choice-filters">
          {[
            ["all", "전체"],
            ["wanted", "먹고 싶다"],
            ["untried", "아직 안 먹음"],
            ["LIKE", "호"],
            ["NEUTRAL", "보통"],
            ["DISLIKE", "불호"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={filter === key ? "active" : ""}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="search-input">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="메뉴 이름 찾기"
            aria-label="메뉴 목록 검색"
          />
        </label>
      </div>
      <div className="choice-table-head">
        <span>ON THE MENU</span>
        <span>MY EXPERIENCE</span>
        <span>NEXT TIME</span>
      </div>
      {visible.length ? (
        <div className="choice-menu-list">
          {visible.map((m, i) => {
            const rs = menuRecords(archive, m.id),
              v = preference(rs),
              latest = rs[0],
              offering =
                place &&
                archive.offerings.find(
                  (o) => o.menu_id === m.id && o.place_id === place.id,
                );
            return (
              <article className="choice-menu-row" key={m.id}>
                <span className="menu-sequence">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="choice-menu-name">
                  <a href={`#/menu/${m.id}`}>
                    <h2>{m.name}</h2>
                  </a>
                  <span>
                    {m.category || "MENU"}
                    {offering?.price !== undefined
                      ? ` · ₩${offering.price.toLocaleString("ko-KR")}`
                      : ""}
                  </span>
                  {latest?.short_note && <p>{latest.short_note}</p>}
                </div>
                <div className="choice-experience">
                  {v ? (
                    <>
                      <VerdictLabel value={v} />
                      <small>
                        {rs.length}번 먹음 · 최근{" "}
                        {latest.eaten_at.slice(5).replace("-", ".")}
                      </small>
                    </>
                  ) : (
                    <>
                      <span className="untried-label">아직 안 먹음</span>
                      <small>궁금한 첫 한 입</small>
                    </>
                  )}
                </div>
                <div className="choice-menu-actions">
                  <WantButton
                    archive={archive}
                    type="MENU"
                    targetId={m.id}
                    onSave={onSave}
                  />
                  <button
                    className="ate-button"
                    onClick={() => onAdd(m.id, place?.id)}
                  >
                    먹었다 <Plus size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          title={
            menus.length
              ? "이 조건의 메뉴는 아직 없네요."
              : "아직 불러온 메뉴가 없습니다."
          }
          description={
            menus.length
              ? "필터나 검색어를 바꿔 보세요."
              : "원본 메뉴를 확인하거나 메뉴 불러오기를 시도할 수 있습니다."
          }
        />
      )}
      <p className="choice-footnote">
        ‘먹고 싶다’는 식사 기록을 저장하면 자동으로 해제됩니다. 먹어본 경험은
        계속 남습니다.
      </p>
      {!!related.length && (
        <section className="venue-discoveries">
          <div className="section-heading">
            <h2>
              Why I saved this<span>이곳이 궁금했던 이유</span>
            </h2>
          </div>
          {related.map((l) => (
            <article key={l.id}>
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                <Play size={15} />
                <span>
                  {l.title}
                  <small>{l.note || "보관한 링크에서 다시 보기"}</small>
                </span>
                <ArrowUpRight size={18} />
              </a>
              <button className="text-button" onClick={() => onEditLink(l.id)}>
                연결 정리
              </button>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

export function ReceiveShare({
  archive,
  params,
  onSave,
  blocked,
}: {
  archive: Archive;
  params: URLSearchParams;
  onSave: Commit;
  blocked: boolean;
}) {
  const [error, setError] = useState(""),
    handled = useRef(""),
    text = [params.get("url"), params.get("text")].filter(Boolean).join("\n");
  useEffect(() => {
    if (blocked || handled.current === text) return;
    handled.current = text;
    setError("");
    try {
      const canonical = sharedUrl(text);
      let linkId = "",
        duplicate = false;
      const ok = onSave((a) => {
        const saved = saveSharedLink(a, canonical, params.get("title") || "");
        linkId = saved.linkId;
        duplicate = saved.duplicate;
        return saved.archive;
      });
      if (ok)
        location.replace(
          `#/choose/reels?received=${duplicate ? "existing" : "saved"}&link=${encodeURIComponent(linkId)}`,
        );
      else
        setError(
          "공유한 링크를 저장하지 못했습니다. 기존 아카이브는 그대로입니다. 저장 공간을 확인하고 다시 시도해 주세요.",
        );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [blocked, text]);
  return (
    <div className="receive-page">
      <span className="eyebrow">링크 보관</span>
      <h1>{error ? "링크를 확인해 주세요." : "발견한 맛을 보관하는 중."}</h1>
      <p role={error ? "alert" : "status"}>
        {error || "음식점 이름은 나중에 붙여도 괜찮아요."}
      </p>
      {error && (
        <a href="#/choose/reels" className="text-button">
          보관함 열기 <ArrowUpRight size={16} />
        </a>
      )}
    </div>
  );
}
