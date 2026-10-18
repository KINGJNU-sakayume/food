import { useEffect, useRef, type ReactNode } from "react";
import { X, Plus } from "lucide-react";
import type { Archive, Menu, Verdict } from "../types/model";
import { isFavourite, menuRecords, preference, verdicts } from "../lib/data";
export const dateLabel = (date: string) =>
  `${date.slice(0, 4)}. ${Number(date.slice(5, 7))}. ${Number(date.slice(8, 10))}.`;
export const shortDate = (date: string) =>
  `${Number(date.slice(5, 7))}.${date.slice(8, 10)}`;
export function VerdictLabel({ value }: { value: Verdict }) {
  return (
    <span className={`verdict ${value.toLowerCase()}`}>
      <span aria-hidden="true">{verdicts[value].mark}</span>{" "}
      {verdicts[value].label}
    </span>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <span />
        <button className="icon-button" aria-label="닫기" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function MenuCover({
  archive,
  menu,
  index = 0,
  large = false,
}: {
  archive: Archive;
  menu: Menu;
  index?: number;
  large?: boolean;
}) {
  const rs = menuRecords(archive, menu.id);
  const photo = rs.flatMap((r) =>
    archive.photos
      .filter((p) => p.eating_record_id === r.id)
      .sort((a, b) => a.sort_order - b.sort_order),
  )[0];
  return (
    <div className={`menu-cover tone-${index % 4} ${large ? "large" : ""}`}>
      {photo ? (
        <img
          src={photo.storage_path}
          alt={`${menu.name} 식사 사진`}
          loading="lazy"
        />
      ) : (
        <div className="cover-center">
          <strong>{menu.name}</strong>
        </div>
      )}
    </div>
  );
}
export function MenuTile({
  archive,
  menu,
  index,
}: {
  archive: Archive;
  menu: Menu;
  index: number;
}) {
  const rs = menuRecords(archive, menu.id),
    v = preference(rs);
  const brand = archive.brands.find((b) => b.id === menu.brand_id);
  const place = archive.places.find((p) => p.id === rs[0]?.place_id);
  return (
    <a className="menu-tile" href={`#/menu/${menu.id}`}>
      <MenuCover archive={archive} menu={menu} index={index} />
      <div className="tile-meta">
        <span>
          {brand?.name || place?.name || menu.category || "나의 메뉴"}
        </span>
      </div>
      <div className="tile-title">
        <h3>{menu.name}</h3>
      </div>
      <div className="tile-bottom">
        {v ? <VerdictLabel value={v} /> : <span>미기록</span>}
        <span>
          {isFavourite(archive, menu.id) && (
            <span className="frequent-label">자주 · </span>
          )}
          {rs.length}번
        </span>
      </div>
    </a>
  );
}
export function Empty({
  title,
  description,
  onAdd,
}: {
  title: string;
  description: string;
  onAdd?: () => void;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol" aria-hidden="true">
        ∅
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {onAdd && (
        <button className="text-button" onClick={onAdd}>
          <Plus size={17} />
          기록 남기기
        </button>
      )}
    </div>
  );
}
