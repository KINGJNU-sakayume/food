import { useState } from "react";
import { Download, Upload, ArrowUpRight } from "lucide-react";
import type { Archive } from "../types/model";
import { emptyArchive, today, validateArchive } from "../lib/data";
import { download } from "../lib/download";
import { Modal } from "./Common";
export default function Settings({
  archive,
  onClose,
  onSave,
  corruptRaw,
}: {
  archive: Archive;
  onClose: () => void;
  onSave: (fn: (a: Archive) => Archive) => boolean;
  corruptRaw?: string;
}) {
  const [name, setName] = useState(archive.user.display_name),
    [pending, setPending] = useState<Archive>(),
    [error, setError] = useState(""),
    [clear, setClear] = useState(false),
    [notice, setNotice] = useState("");
  async function importFile(file?: File) {
    if (!file) return;
    setError("");
    setPending(undefined);
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("20MB 이하의 JSON 파일을 선택해 주세요.");
      setPending(validateArchive(JSON.parse(await file.text())));
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "JSON 파일을 읽을 수 없습니다. 파일 형식을 확인해 주세요."
          : (e as Error).message,
      );
    }
  }
  const csv = () => {
    const cell = (v: unknown) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s.replaceAll('"', '""')}"`;
    };
    const rows = [
      [
        "날짜",
        "메뉴",
        "브랜드",
        "장소",
        "평가",
        "재주문",
        "메모",
        "상세메모",
        "가격",
        "태그",
      ],
      ...archive.records.map((r) => {
        const m = archive.menus.find((m) => m.id === r.menu_id);
        return [
          r.eaten_at,
          m?.name,
          archive.brands.find((b) => b.id === m?.brand_id)?.name,
          archive.places.find((p) => p.id === r.place_id)?.name,
          r.verdict,
          r.reorder_intent,
          r.short_note,
          r.detailed_note,
          r.price_paid,
          archive.record_tags
            .filter((t) => t.eating_record_id === r.id)
            .map((t) => archive.tags.find((x) => x.id === t.tag_id)?.name)
            .join(", "),
        ];
      }),
    ];
    download(
      `palate-${today()}.csv`,
      "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n"),
      "text/csv;charset=utf-8",
    );
  };
  return (
    <Modal title="YOUR ARCHIVE" onClose={onClose}>
      <div className="settings">
        <h2>오래 간직할 취향.</h2>
        <p className="muted">
          기록은 이 브라우저에 저장됩니다. 다른 기기로 옮길 때는 JSON으로 백업해
          주세요.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              onSave((a) => ({
                ...a,
                user: {
                  ...a.user,
                  display_name: name.trim() || "나의 아카이브",
                },
              }))
            )
              setNotice("아카이브 이름을 저장했습니다.");
          }}
        >
          <label className="field">
            <span>아카이브 이름</span>
            <input
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="text-button">
            이름 저장 <ArrowUpRight size={16} />
          </button>
        </form>
        <div className="settings-section">
          <h3>내 기록 가져가기</h3>
          <p className="muted">
            JSON에는 메뉴, 식사 기록, 태그와 사진이 모두 포함됩니다. CSV는 표로
            읽기 위한 기록 목록입니다.
          </p>
          <button
            className="settings-action"
            onClick={() =>
              download(
                `palate-${today()}.json`,
                JSON.stringify(archive, null, 2),
              )
            }
          >
            <Download size={18} />
            <span>
              JSON 백업 <small>사진을 포함한 전체 아카이브</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
          <button className="settings-action" onClick={csv}>
            <Download size={18} />
            <span>
              CSV 내보내기 <small>스프레드시트에서 열기</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
          {corruptRaw && (
            <button
              className="settings-action"
              onClick={() =>
                download(
                  `palate-recovery-${today()}.txt`,
                  corruptRaw,
                  "text/plain",
                )
              }
            >
              <Download size={18} />
              <span>
                복구용 원본 내려받기<small>읽지 못한 저장 데이터 보존</small>
              </span>
            </button>
          )}
        </div>
        <div className="settings-section">
          <h3>백업 불러오기</h3>
          <label className="settings-action upload-button">
            <Upload size={18} />
            <span>
              JSON 파일 선택<small>검사한 뒤 복원 여부를 확인합니다</small>
            </span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {pending && (
            <div className="inline-notice">
              <p>
                <strong>{pending.user.display_name}</strong>
                <br />
                메뉴 {pending.menus.length}개 · 식사 {pending.records.length}건
                · 사진 {pending.photos.length}장
              </p>
              <p>
                현재 아카이브 전체를 이 백업으로 교체합니다. 먼저 현재 기록을
                백업해 주세요.
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  onClick={() => {
                    if (onSave(() => pending)) {
                      setPending(undefined);
                      onClose();
                    }
                  }}
                >
                  이 백업으로 복원
                </button>
                <button
                  className="text-button"
                  onClick={() => setPending(undefined)}
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="settings-section">
          <h3>기기에 남는 개인 기록</h3>
          <p className="muted">
            계정이나 서버 전송 없이 이 기기에서 사용합니다. 브라우저 데이터
            삭제, 시크릿 모드 종료 시 기록이 사라질 수 있습니다. 같은 브라우저
            프로필을 쓰는 사람은 기록을 열 수 있습니다.
          </p>
          <p className="micro">
            저장된 데이터 약{" "}
            {(new Blob([JSON.stringify(archive)]).size / 1024).toFixed(0)} KB ·
            프로필 1개
          </p>
        </div>
        <div className="settings-section">
          <button
            className="text-button danger"
            onClick={() => setClear(!clear)}
          >
            {archive.demo ? "예시를 지우고 새로 시작" : "아카이브 전체 비우기"}
          </button>
          {clear && (
            <div className="inline-notice">
              <p>
                메뉴, 기록과 사진을 모두 삭제합니다. JSON 백업이 있어야 복원할
                수 있습니다.
              </p>
              <div className="button-row">
                <button
                  className="danger-button"
                  onClick={() => {
                    if (onSave(() => emptyArchive())) onClose();
                  }}
                >
                  모든 데이터 삭제
                </button>
                <button className="text-button" onClick={() => setClear(false)}>
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
    </Modal>
  );
}
