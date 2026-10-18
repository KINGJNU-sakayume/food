import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Search, Link as LinkIcon, Plus } from "lucide-react";
import type { Archive } from "../types/model";
import {
  applyRestaurantDetails,
  savePlace,
  type RestaurantDetails,
  type RestaurantResult,
} from "../lib/discovery";
import { defaultEndpoint, restaurantProvider } from "../lib/restaurants";
import { httpsUrl } from "../lib/urls";
import { Modal } from "./Common";
import type { Commit } from "./DiscoveryCommon";
export default function AddPlace({
  archive,
  onSave,
  onClose,
  initialLinkId,
}: {
  archive: Archive;
  onSave: Commit;
  onClose: () => void;
  initialLinkId?: string;
}) {
  const link = archive.saved_links.find((l) => l.id === initialLinkId),
    [mode, setMode] = useState(link ? "link" : "search"),
    [query, setQuery] = useState(""),
    [url, setUrl] = useState(link?.url || ""),
    [name, setName] = useState(""),
    [address, setAddress] = useState(""),
    [results, setResults] = useState<RestaurantResult[]>([]),
    [selected, setSelected] = useState<RestaurantResult>(),
    [details, setDetails] = useState<RestaurantDetails>(),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [menuNotice, setMenuNotice] = useState(""),
    [searched, setSearched] = useState(false);
  const endpoint = archive.preferences.restaurant_endpoint || defaultEndpoint(),
    provider = restaurantProvider(endpoint),
    controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  const changeMode = (value: string) => {
    controller.current?.abort();
    setMode(value);
    setLoading(false);
    setError("");
    setSelected(undefined);
    setDetails(undefined);
    setMenuNotice("");
  };
  async function search() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError("");
    setSearched(true);
    setResults([]);
    try {
      setResults(await provider.search(query, abort.signal));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }
  async function choose(result: RestaurantResult) {
    setSelected(result);
    setName(result.name);
    setAddress(result.address);
    setDetails(undefined);
    setMenuNotice("");
    if (!endpoint || !result.source_url) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      const data = await provider.details(result.source_url, abort.signal);
      setDetails(data);
      if (!data.menus.length)
        setMenuNotice(
          "출처에 읽을 수 있는 메뉴 목록이 없습니다. 음식점과 원본 링크는 저장할 수 있어요.",
        );
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setMenuNotice((e as Error).message);
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }
  async function lookup() {
    const safe = httpsUrl(url);
    if (!safe) {
      setError("음식점의 https 링크를 입력해 주세요.");
      return;
    }
    if (!endpoint) {
      setSelected({ name: "", address: "", source_url: safe });
      setError("");
      setMenuNotice(
        "자동 정보 연결 전에도 이름과 원본 링크를 저장할 수 있어요. 자동 불러오기는 설정의 음식점 정보 연결이 필요합니다.",
      );
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError("");
    try {
      const data = await provider.details(safe, abort.signal);
      setSelected(data);
      setDetails(data);
      setName(data.name);
      setAddress(data.address);
      setMenuNotice(
        data.menus.length
          ? `메뉴 ${data.menus.length}개를 함께 불러왔습니다.`
          : "출처에서 메뉴 목록을 제공하지 않았습니다. 음식점 정보는 저장할 수 있어요.",
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
        setSelected({ name: "", address: "", source_url: safe });
      }
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }
  function save() {
    let placeId = "";
    if (
      onSave((a) => {
        const saved = savePlace(a, {
          ...(selected || { address }),
          name: name.trim(),
          address,
          source_url:
            selected?.source_url ||
            (mode === "link" ? httpsUrl(url) : undefined),
        });
        placeId = saved.placeId;
        let next = details
          ? applyRestaurantDetails(saved.archive, placeId, details)
          : saved.archive;
        if (link)
          next = {
            ...next,
            saved_links: next.saved_links.map((l) =>
              l.id === link.id
                ? {
                    ...l,
                    targets: [
                      ...l.targets.filter(
                        (t) => !(t.type === "PLACE" && t.id === placeId),
                      ),
                      { type: "PLACE", id: placeId },
                    ],
                    updated_at: new Date().toISOString(),
                  }
                : l,
            ),
          };
        return next;
      })
    ) {
      onClose();
      location.hash = `/choose/place/${placeId}`;
    }
  }
  return (
    <Modal title="ADD A PLACE" onClose={onClose} wide>
      <div className="quick-form">
        <h2>다음에 가볼 곳.</h2>
        <p className="muted">
          음식점 이름으로 찾거나 지도·배달 앱의 링크를 가져오세요.
        </p>
        <div className="discovery-switch">
          {[
            ["search", "이름으로 찾기"],
            ["link", "링크 가져오기"],
            ["manual", "직접 추가"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={mode === value}
              className={mode === value ? "active" : ""}
              onClick={() => changeMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "search" && (
          <>
            <form
              className="place-find"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <label className="field">
                <span>음식점 이름과 지역</span>
                <input
                  autoFocus
                  required
                  minLength={2}
                  maxLength={100}
                  value={query}
                  placeholder="예: 을밀대 마포"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button className="primary" disabled={loading}>
                <Search size={17} />
                {loading ? "찾는 중…" : "검색"}
              </button>
            </form>
            <p className="micro">
              {endpoint &&
              !results.some((r) => r.external_provider === "OPENSTREETMAP")
                ? "연결한 음식점 검색 서비스"
                : "Photon · OpenStreetMap 기반 검색"}
              에서 검색합니다. 검색어는 해당 서비스로 전달됩니다.
            </p>
            <div className="place-results">
              {results.map((r, i) => (
                <button
                  key={r.external_place_id || i}
                  className={selected === r ? "selected" : ""}
                  disabled={loading}
                  onClick={() => void choose(r)}
                >
                  <span>
                    <strong>{r.name}</strong>
                    <small>{r.address}</small>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
              ))}
            </div>
            {searched && !loading && !results.length && !error && (
              <p className="muted search-empty-note">
                찾은 음식점이 없습니다. 지역명을 함께 입력하거나 지도 링크를
                가져와 보세요.
              </p>
            )}
            {(!endpoint ||
              results.some((r) => r.external_provider === "OPENSTREETMAP")) && (
              <a
                className="text-button"
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
              >
                © OpenStreetMap contributors <ArrowUpRight size={12} />
              </a>
            )}
          </>
        )}
        {mode === "link" && (
          <div className="place-find">
            <label className="field">
              <span>네이버지도·배민·음식점 링크</span>
              <input
                autoFocus
                type="url"
                maxLength={4000}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setSelected(undefined);
                  setDetails(undefined);
                  setName("");
                  setAddress("");
                  setMenuNotice("");
                }}
                placeholder="https://naver.me/…"
              />
            </label>
            <button
              className="primary"
              disabled={loading || !url}
              onClick={() => void lookup()}
            >
              <LinkIcon size={17} />
              {loading ? "불러오는 중…" : "정보 불러오기"}
            </button>
          </div>
        )}
        {(mode === "manual" || selected) && (
          <form
            className="place-confirm"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label className="field">
              <span>음식점 이름</span>
              <input
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              <span>주소 또는 동네</span>
              <input
                maxLength={2000}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            {menuNotice && (
              <p className="import-notice" role="status">
                {menuNotice}
              </p>
            )}
            <button className="primary save-button" disabled={loading}>
              <Plus size={17} />
              {details?.menus.length
                ? `메뉴 ${details.menus.length}개와 함께 저장`
                : "내 음식점에 저장"}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
