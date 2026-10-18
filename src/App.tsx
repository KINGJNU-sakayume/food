import { useEffect, useRef, useState } from "react";
import {
  Search,
  Plus,
  ArrowUpRight,
  Settings as SettingsIcon,
  LockKeyhole,
  Download,
} from "lucide-react";
import type { Archive, EatingRecord } from "./types/model";
import {
  emptyArchive,
  normalize,
  persistArchive,
  removePlace,
  removeRecord,
  searchable,
  STORAGE_KEY,
  today,
  validateArchive,
} from "./lib/data";
import { download } from "./lib/download";
import { loadDemo } from "./lib/demo";
import { Modal, dateLabel, Empty } from "./components/Common";
import QuickAdd from "./components/QuickAdd";
import Settings from "./components/Settings";
import ChoosePage, { ReceiveShare } from "./pages/ChoosePage";
import {
  Collection,
  Insights,
  Journal,
  MenuDetail,
  Places,
} from "./pages/ArchivePages";

function load() {
  let raw: string | undefined;
  try {
    raw = localStorage.getItem(STORAGE_KEY) ?? undefined;
    return {
      archive: raw ? validateArchive(JSON.parse(raw)) : emptyArchive(),
      raw: undefined as string | undefined,
      error: "",
    };
  } catch {
    return {
      archive: emptyArchive(),
      raw,
      error:
        "저장된 아카이브를 읽을 수 없습니다. 원본을 내려받아 보관한 뒤 복원하거나 새로 시작해 주세요.",
    };
  }
}
export default function App() {
  const [boot] = useState(load),
    [archive, setArchive] = useState(boot.archive),
    [recovery, setRecovery] = useState(boot.error),
    [corruptRaw, setCorruptRaw] = useState(boot.raw),
    [route, setRoute] = useState(location.hash || "#/collection"),
    [quick, setQuick] = useState<{
      record?: EatingRecord;
      menuId?: string;
      placeId?: string;
    }>(),
    [syncRevision, setSyncRevision] = useState(0),
    [settings, setSettings] = useState(false),
    [search, setSearch] = useState(false),
    [query, setQuery] = useState(""),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState<EatingRecord>(),
    [deletingPlace, setDeletingPlace] = useState<string>(),
    [demoConfirm, setDemoConfirm] = useState(false),
    [demoLoading, setDemoLoading] = useState(false),
    [restore, setRestore] = useState<Archive>();
  const archiveRef = useRef(archive),
    timer = useRef<ReturnType<typeof setTimeout>>();
  const notify = (message: string) => {
    setToast(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4500);
  };
  useEffect(() => {
    const change = () => {
      setRoute(location.hash || "#/collection");
      setSearch(false);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      try {
        const a = event.newValue
          ? validateArchive(JSON.parse(event.newValue))
          : emptyArchive();
        archiveRef.current = a;
        setArchive(a);
        setQuick(undefined);
        setSettings(false);
        setDeleting(undefined);
        setDeletingPlace(undefined);
        setDemoConfirm(false);
        setSyncRevision((value) => value + 1);
        notify("다른 탭에서 변경된 아카이브를 불러왔습니다.");
      } catch {
        setCorruptRaw(event.newValue ?? undefined);
        setRecovery(
          "다른 탭의 저장 데이터를 읽을 수 없습니다. 기존 원본을 보관해 주세요.",
        );
      }
    };
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("storage", sync);
      clearTimeout(timer.current);
    };
  }, []);
  function commit(
    fn: (a: Archive) => Archive,
    message: string | false = "아카이브에 저장했습니다.",
  ): boolean {
    try {
      if (recovery) throw new Error("먼저 아카이브 복구를 완료해 주세요.");
      // Read the latest saved value before applying an incoming share or edit.
      // Another tab may have saved a link before its storage event arrives.
      const stored = localStorage.getItem(STORAGE_KEY);
      const current = stored
        ? validateArchive(JSON.parse(stored))
        : archiveRef.current;
      const next = validateArchive(fn(current));
      persistArchive(next);
      archiveRef.current = next;
      setArchive(next);
      setError("");
      if (message) notify(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  function recover(next: Archive) {
    try {
      persistArchive(next);
      archiveRef.current = next;
      setArchive(next);
      setRecovery("");
      setCorruptRaw(undefined);
      setRestore(undefined);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const routeUrl = new URL(
    route.replace(/^#/, "") || "/collection",
    "https://palate.local",
  );
  const path = routeUrl.pathname.replace(/^\//, "").split("/"),
    page = path[0] || "collection";
  const add = (menuId?: string, placeId?: string) => {
    setError("");
    setQuick({ menuId, placeId });
  };
  const edit = (record: EatingRecord) => {
    setError("");
    setQuick({ record });
  };
  const matches = archive.menus.filter(
    (m) => query.trim() && searchable(archive, m.id).includes(normalize(query)),
  );
  const matchingPlaces = archive.places.filter(
    (p) =>
      query.trim() && normalize(p.name + p.address).includes(normalize(query)),
  );
  const matchingBrands = archive.brands.filter(
    (b) => query.trim() && normalize(b.name).includes(normalize(query)),
  );
  const matchingNotes = archive.records.filter(
    (r) =>
      query.trim() &&
      normalize(r.short_note + " " + r.detailed_note).includes(
        normalize(query),
      ),
  );
  return (
    <div className="app">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        본문으로 건너뛰기
      </a>
      <div className="masthead-note">
        <span>A PRIVATE ARCHIVE OF TASTE.</span>
        <span>취향은, 개인적인 것.</span>
      </div>
      <header className="site-header">
        <a href="#/collection" className="wordmark" aria-label="PALATE 컬렉션">
          PALATE
        </a>
        <nav aria-label="주 메뉴">
          {[
            ["collection", "Collection", "컬렉션"],
            ["choose", "Choose", "고르기"],
            ["journal", "Journal", "기록"],
            ["places", "Places", "장소"],
            ["insights", "Insights", "취향"],
          ].map(([key, label, ko]) => (
            <a
              href={`#/${key}`}
              aria-label={`${label} ${ko}`}
              className={
                page === key || (page === "menu" && key === "collection")
                  ? "active"
                  : ""
              }
              aria-current={
                page === key || (page === "menu" && key === "collection")
                  ? "page"
                  : undefined
              }
              key={key}
            >
              <span>{label}</span>
              <small>{ko}</small>
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="전체 검색"
            onClick={() => {
              setSearch(true);
              setQuery("");
            }}
          >
            <Search size={21} />
          </button>
          <button
            className="icon-button settings-open"
            aria-label="아카이브 설정과 백업"
            onClick={() => setSettings(true)}
          >
            <SettingsIcon size={20} />
          </button>
          <button className="primary header-add" onClick={() => add()}>
            <Plus size={17} />
            <span>기록하기</span>
          </button>
        </div>
      </header>
      {archive.demo && (
        <div className="demo-banner">
          <span>
            예시 아카이브를 보고 있습니다. 가상의 기록과 참고 사진입니다.
          </span>
          <button onClick={() => setSettings(true)}>
            새로 시작하기 <ArrowUpRight size={14} />
          </button>
        </div>
      )}
      <main
        id="main-content"
        tabIndex={-1}
        key={`${page}-${path[1] || ""}-${syncRevision}`}
      >
        {page === "collection" ? (
          <Collection
            archive={archive}
            onAdd={add}
            onDemo={() => setDemoConfirm(true)}
          />
        ) : page === "choose" ? (
          <ChoosePage
            archive={archive}
            path={path}
            params={routeUrl.searchParams}
            onSave={commit}
            onAdd={add}
            onSettings={() => setSettings(true)}
          />
        ) : page === "receive" ? (
          <ReceiveShare
            archive={archive}
            params={routeUrl.searchParams}
            onSave={commit}
            blocked={!!recovery}
          />
        ) : page === "journal" ? (
          <Journal
            archive={archive}
            onAdd={add}
            onEdit={edit}
            onDelete={setDeleting}
          />
        ) : page === "places" ? (
          <Places
            archive={archive}
            selectedId={path[1]}
            onUpdate={commit}
            onDeletePlace={setDeletingPlace}
          />
        ) : page === "insights" ? (
          <Insights archive={archive} />
        ) : page === "menu" ? (
          <MenuDetail
            archive={archive}
            menuId={path[1]}
            onAdd={add}
            onEdit={edit}
            onDelete={setDeleting}
            onUpdate={commit}
          />
        ) : (
          <Empty
            title="이 페이지는 아직 비어 있습니다."
            description="위 메뉴에서 아카이브를 열어보세요."
          />
        )}
      </main>
      <footer className="site-footer">
        <a href="#/collection" className="footer-mark">
          PALATE.
        </a>
        <span>
          A private archive of taste.
          <br />
          <small>{archive.user.display_name}</small>
          {archive.places.some(
            (p) => p.external_provider === "OPENSTREETMAP",
          ) && (
            <a
              className="osm-credit"
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              음식점 정보 © OpenStreetMap contributors
            </a>
          )}
        </span>
        <button className="text-button" onClick={() => setSettings(true)}>
          <LockKeyhole size={13} />이 기기에 저장됨{" "}
          <span className="footer-backup">/ 백업과 설정</span>
          <ArrowUpRight size={14} />
        </button>
      </footer>
      {page !== "choose" && page !== "receive" && (
        <button
          className="mobile-add"
          aria-label="새 식사 기록"
          onClick={() => add()}
        >
          <Plus size={25} />
        </button>
      )}
      {quick && (
        <QuickAdd
          archive={archive}
          record={quick.record}
          initialMenuId={quick.menuId}
          initialPlaceId={quick.placeId}
          onClose={() => setQuick(undefined)}
          onSave={commit}
        />
      )}
      {settings && (
        <Settings
          archive={archive}
          onClose={() => setSettings(false)}
          onSave={commit}
          corruptRaw={corruptRaw}
        />
      )}
      {search && (
        <Modal title="SEARCH THE ARCHIVE" onClose={() => setSearch(false)} wide>
          <div className="global-search">
            <h2>어떤 맛을 찾고 있나요?</h2>
            <label className="global-search-field">
              <Search size={24} />
              <input
                autoFocus
                placeholder="메뉴, 브랜드, 장소, 태그와 메모"
                aria-label="전체 아카이브 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {!query.trim() ? (
              <p className="muted">기억나는 단어 하나로 찾아보세요.</p>
            ) : (
              <>
                <div className="search-result-group">
                  <div className="eyebrow">MENUS / 메뉴와 태그</div>
                  {matches.map((m) => (
                    <a
                      href={`#/menu/${m.id}`}
                      key={m.id}
                      onClick={() => setSearch(false)}
                    >
                      <strong>{m.name}</strong>
                      <span>
                        {m.category}
                        <ArrowUpRight size={17} />
                      </span>
                    </a>
                  ))}
                </div>
                {!!matchingBrands.length && (
                  <div className="search-result-group">
                    <div className="eyebrow">BRANDS / 브랜드</div>
                    {matchingBrands.map((b) => (
                      <a
                        key={b.id}
                        href={`#/places/${b.id}`}
                        onClick={() => setSearch(false)}
                      >
                        {b.name}
                        <ArrowUpRight size={17} />
                      </a>
                    ))}
                  </div>
                )}
                {!!matchingPlaces.length && (
                  <div className="search-result-group">
                    <div className="eyebrow">PLACES / 장소</div>
                    {matchingPlaces.map((p) => (
                      <a
                        key={p.id}
                        href={`#/places/${p.id}`}
                        onClick={() => setSearch(false)}
                      >
                        {p.name}
                        <ArrowUpRight size={17} />
                      </a>
                    ))}
                  </div>
                )}
                {!!matchingNotes.length && (
                  <div className="search-result-group">
                    <div className="eyebrow">NOTES / 기록 속 기억</div>
                    {matchingNotes.map((r) => (
                      <a
                        href={`#/menu/${r.menu_id}`}
                        key={r.id}
                        onClick={() => setSearch(false)}
                      >
                        <div>
                          <small>
                            {
                              archive.menus.find((m) => m.id === r.menu_id)
                                ?.name
                            }{" "}
                            · {dateLabel(r.eaten_at)}
                          </small>
                          <p>{r.short_note || r.detailed_note}</p>
                        </div>
                        <ArrowUpRight size={17} />
                      </a>
                    ))}
                  </div>
                )}
                {!matches.length &&
                  !matchingPlaces.length &&
                  !matchingBrands.length &&
                  !matchingNotes.length && (
                    <Empty
                      title="아직 이 기억은 없네요."
                      description="다른 단어로 찾아보세요."
                    />
                  )}
              </>
            )}
          </div>
        </Modal>
      )}
      {demoConfirm && (
        <Modal title="SAMPLE ARCHIVE" onClose={() => setDemoConfirm(false)}>
          <div className="confirm-content">
            <h2>기록이 쌓이면 이런 모습.</h2>
            <p>
              가상의 메뉴 7개와 식사 기록 10건을 이 기기에 불러옵니다. 설정에서
              예시를 지우고 새로 시작할 수 있습니다.
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={demoLoading}
                onClick={async () => {
                  setDemoLoading(true);
                  try {
                    const sample = await loadDemo();
                    if (commit(() => sample)) setDemoConfirm(false);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setDemoLoading(false);
                  }
                }}
              >
                {demoLoading ? "불러오는 중…" : "예시 둘러보기"}
                <ArrowUpRight size={17} />
              </button>
              <button
                className="text-button"
                onClick={() => setDemoConfirm(false)}
              >
                취소
              </button>
            </div>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal title="DELETE RECORD" onClose={() => setDeleting(undefined)}>
          <div className="confirm-content">
            <h2>이 식사의 기록을 지울까요?</h2>
            <p>
              {archive.menus.find((m) => m.id === deleting.menu_id)?.name} ·{" "}
              {dateLabel(deleting.eaten_at)}
              <br />이 기록의 사진과 태그 연결도 지워집니다. 메뉴와 다른 식사
              기록은 남습니다.
            </p>
            <div className="button-row">
              <button
                className="danger-button"
                onClick={() => {
                  if (commit((a) => removeRecord(a, deleting.id)))
                    setDeleting(undefined);
                }}
              >
                기록 삭제
              </button>
              <button
                className="text-button"
                onClick={() => setDeleting(undefined)}
              >
                남겨두기
              </button>
            </div>
          </div>
        </Modal>
      )}
      {deletingPlace && (
        <Modal title="DELETE PLACE" onClose={() => setDeletingPlace(undefined)}>
          <div className="confirm-content">
            <h2>장소 정보를 삭제할까요?</h2>
            <p>
              장소와 메뉴 판매 정보만 삭제합니다. 이 장소에서 먹은 식사 기록과
              사진은 장소 미기록 상태로 보존됩니다.
            </p>
            <div className="button-row">
              <button
                className="danger-button"
                onClick={() => {
                  if (commit((a) => removePlace(a, deletingPlace))) {
                    setDeletingPlace(undefined);
                    location.hash = "/places";
                  }
                }}
              >
                장소 삭제
              </button>
              <button
                className="text-button"
                onClick={() => setDeletingPlace(undefined)}
              >
                취소
              </button>
            </div>
          </div>
        </Modal>
      )}
      {recovery && (
        <Modal title="ARCHIVE RECOVERY" onClose={() => {}}>
          <div className="confirm-content">
            <h2>기록을 먼저 보관해 주세요.</h2>
            <p>{recovery}</p>
            {corruptRaw && (
              <button
                className="primary"
                onClick={() =>
                  download(
                    `palate-recovery-${today()}.txt`,
                    corruptRaw,
                    "text/plain",
                  )
                }
              >
                <Download size={17} />
                저장 원본 내려받기
              </button>
            )}
            <label className="field">
              <span>정상 JSON 백업 선택</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 20 * 1024 * 1024)
                      throw new Error("20MB 이하 파일을 선택해 주세요.");
                    setRestore(validateArchive(JSON.parse(await file.text())));
                    setError("");
                  } catch {
                    setError("유효한 PALATE JSON 백업을 선택해 주세요.");
                  }
                }}
              />
            </label>
            {restore && (
              <button className="primary" onClick={() => recover(restore)}>
                식사 {restore.records.length}건의 백업으로 복원
              </button>
            )}
            <button
              className="text-button danger"
              onClick={() => {
                if (corruptRaw)
                  download(
                    `palate-recovery-${today()}.txt`,
                    corruptRaw,
                    "text/plain",
                  );
                recover(emptyArchive());
              }}
            >
              원본을 내려받고 새로 시작
            </button>
            <p className="micro">원본은 선택 전까지 덮어쓰지 않습니다.</p>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {error && (
        <Modal title="SAVE ERROR" onClose={() => setError("")}>
          <div className="confirm-content">
            <h2>저장하지 못했습니다.</h2>
            <p role="alert">{error}</p>
            <button className="primary" onClick={() => setError("")}>
              확인
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
