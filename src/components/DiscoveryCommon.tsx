import { useState } from "react";
import { Bookmark, Check, Copy, Plus, X, ExternalLink } from "lucide-react";
import type { Archive, LinkTarget, TargetType } from "../types/model";
import {
  isWanted,
  saveSharedLink,
  toggleWish,
  updateSavedLink,
  venueTitle,
} from "../lib/discovery";
import { sharedUrl } from "../lib/urls";
import { normalize } from "../lib/data";
import { Modal } from "./Common";

export type Commit = (
  fn: (a: Archive) => Archive,
  message?: string | false,
) => boolean;
export function WantButton({
  archive,
  type,
  targetId,
  onSave,
  place = false,
  compact = false,
  name,
}: {
  archive: Archive;
  type: TargetType;
  targetId: string;
  onSave: Commit;
  place?: boolean;
  compact?: boolean;
  name?: string;
}) {
  const active = isWanted(archive, type, targetId),
    label = place ? "가보고 싶다" : "먹고 싶다";
  return (
    <button
      type="button"
      className={`want-button ${active ? "wanted" : ""} ${compact ? "compact" : ""}`}
      aria-pressed={active}
      aria-label={name ? `${name} ${label}` : label}
      onClick={() => onSave((a) => toggleWish(a, type, targetId), false)}
    >
      {active ? (
        <Check size={compact ? 20 : 16} />
      ) : (
        <Bookmark size={compact ? 20 : 16} />
      )}
      {!compact && <span>{label}</span>}
    </button>
  );
}
export function PasteLink({
  onSave,
  onClose,
}: {
  onSave: Commit;
  onClose: () => void;
}) {
  const [text, setText] = useState(""),
    [title, setTitle] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal title="SAVE A DISCOVERY" onClose={onClose}>
      <form
        className="quick-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const url = sharedUrl(text);
            if (onSave((a) => saveSharedLink(a, url, title).archive)) onClose();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <h2>발견한 맛을, 일단 저장.</h2>
        <p className="muted">
          릴스나 음식점 링크만 넣어 주세요. 어디에 연결할지는 나중에 정해도
          됩니다.
        </p>
        <label className="field">
          <span>공유한 링크 또는 텍스트</span>
          <textarea
            required
            autoFocus
            rows={3}
            maxLength={8000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="https://www.instagram.com/reel/…"
          />
        </label>
        <label className="field">
          <span>
            기억할 이름 <small>선택</small>
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="연남동에서 꼭 가보고 싶은 곳"
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary save-button">
          <Bookmark size={17} />
          보관함에 저장
        </button>
      </form>
    </Modal>
  );
}
export function LinkEditor({
  archive,
  linkId,
  onSave,
  onClose,
}: {
  archive: Archive;
  linkId: string;
  onSave: Commit;
  onClose: () => void;
}) {
  const link = archive.saved_links.find((l) => l.id === linkId)!;
  const [title, setTitle] = useState(link.title),
    [note, setNote] = useState(link.note),
    [targets, setTargets] = useState(link.targets),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState<TargetType>("PLACE");
  const choices = (
    kind === "PLACE"
      ? archive.places
      : kind === "BRAND"
        ? archive.brands
        : archive.menus
  )
    .filter((x) => !query || normalize(x.name).includes(normalize(query)))
    .slice(0, 20);
  const toggle = (target: LinkTarget) =>
    setTargets((current) =>
      current.some((t) => t.type === target.type && t.id === target.id)
        ? current.filter((t) => !(t.type === target.type && t.id === target.id))
        : [...current, target],
    );
  return (
    <Modal title="ORGANISE A DISCOVERY" onClose={onClose}>
      <form
        className="quick-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (onSave((a) => updateSavedLink(a, link.id, title, note, targets)))
            onClose();
        }}
      >
        <h2>어떤 맛이 궁금했나요?</h2>
        <a
          className="text-button source-link"
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          원본 열기 <ExternalLink size={14} />
        </a>
        <label className="field">
          <span>기억할 이름</span>
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>짧은 메모</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="여기서는 들기름 막국수를 먹어보기"
          />
        </label>
        <div className="field">
          <span>
            음식점·브랜드·메뉴에 연결 <small>여러 개 선택 가능</small>
          </span>
          <div className="target-pills">
            {targets.map((t) => (
              <button
                key={t.type + t.id}
                type="button"
                onClick={() => toggle(t)}
              >
                {venueTitle(archive, t)}
                <X size={13} />
              </button>
            ))}
          </div>
          <div className="connection-tools">
            <select
              aria-label="연결할 항목 종류"
              value={kind}
              onChange={(e) => setKind(e.target.value as TargetType)}
            >
              <option value="PLACE">음식점</option>
              <option value="BRAND">브랜드</option>
              <option value="MENU">메뉴</option>
            </select>
            <input
              aria-label="연결할 항목 검색"
              placeholder="내 목록에서 찾기"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="connection-list">
            {choices.map((c) => {
              const active = targets.some(
                (t) => t.type === kind && t.id === c.id,
              );
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle({ type: kind, id: c.id })}
                >
                  <span>{c.name}</span>
                  {active ? <Check size={16} /> : <Plus size={16} />}
                </button>
              );
            })}
            {!choices.length && (
              <p className="micro">
                먼저 고르기 탭에 음식점을 저장하면 여기서 연결할 수 있어요.
              </p>
            )}
          </div>
        </div>
        <button className="primary save-button">정리한 내용 저장</button>
      </form>
    </Modal>
  );
}
export function ShortcutGuide({ onClose }: { onClose: () => void }) {
  const base = new URL("./", location.href);
  base.hash = "";
  base.search = "";
  const prefix = base.href + "#/receive?text=";
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="SAVE FROM YOUR IPHONE" onClose={onClose} wide>
      <div className="shortcut-guide">
                <h2>공유 메뉴에서, 바로 보관함으로.</h2>
        <p>
          아이폰 단축어에 아래 동작을 한 번 만들어 두세요. 릴스를 보다가 공유
          시트의 <strong>PALATE에 저장</strong>을 누르면 이 브라우저에서
          PALATE가 열리며 링크가 저장됩니다.
        </p>
        <ol className="shortcut-steps">
          <li>
            <b>새 단축어 만들기</b>
            <p>
              아이폰의 단축어 앱에서 새 단축어를 만들고 이름을{" "}
              <strong>PALATE에 저장</strong>으로 지정합니다. 세부사항에서{" "}
              <strong>공유 시트에서 보기</strong>를 켜고, 입력은{" "}
              <strong>URL과 텍스트</strong>를 받도록 설정합니다.
            </p>
          </li>
          <li>
            <b>‘URL 인코딩’ 동작 추가</b>
            <p>
              입력으로 <strong>단축어 입력</strong>을 선택하고 ‘인코딩’을
              사용합니다. 링크의 특수문자까지 안전하게 전달하기 위한 동작입니다.
            </p>
          </li>
          <li>
            <b>‘텍스트’ 동작 추가</b>
            <p>
              아래 주소를 붙여넣고 맨 끝에 바로{" "}
              <strong>URL 인코딩 결과 변수</strong>를 삽입합니다. 주소와 변수
              사이에 공백이나 줄바꿈을 넣지 않습니다.
            </p>
            <code className="shortcut-url">
              {prefix}
              <em>[URL 인코딩 결과]</em>
            </code>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(prefix);
                  setCopied(true);
                } catch {
                  setError("주소를 길게 눌러 직접 복사해 주세요.");
                }
              }}
            >
              <Copy size={15} />
              {copied ? "주소를 복사했습니다" : "앞부분 주소 복사"}
            </button>
          </li>
          <li>
            <b>‘URL 열기’ 동작 추가</b>
            <p>
              입력으로 바로 앞에서 만든 <strong>텍스트</strong>를 선택하고
              저장합니다.
            </p>
          </li>
          <li>
            <b>인스타그램에서 확인하기</b>
            <p>
              릴스의 공유 메뉴에서 아이폰 공유 시트를 열고{" "}
              <strong>PALATE에 저장</strong>을 선택합니다. PALATE에 저장 완료가
              표시되면 끝입니다. 같은 링크를 여러 번 보내도 한 번만 보관합니다.
            </p>
          </li>
        </ol>
        <div className="inline-notice">
          <p>
            단축어가 여는 브라우저에서 PALATE를 사용해 주세요. Safari, 다른
            브라우저와 홈 화면에 추가한 앱은 저장 공간이 다를 수 있습니다. 옮길
            때는 JSON 백업·복원을 사용하세요.
          </p>
          <p>
            공유 동작은 실제 아이폰에서 한 번 확인해 주세요. 앱을 닫은 상태에서
            보이지 않게 저장하는 방식은 아닙니다.
          </p>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <a
          href="https://support.apple.com/ko-kr/guide/shortcuts/apd163eb9f95/ios"
          target="_blank"
          rel="noopener noreferrer"
          className="text-button"
        >
          Apple의 공유 시트 단축어 안내
          <ExternalLink size={14} />
        </a>
      </div>
    </Modal>
  );
}
