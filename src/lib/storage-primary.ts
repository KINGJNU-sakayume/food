/**
 * P2-B opt-in primary storage. Existing localStorage JSON is a frozen rollback
 * snapshot. Nothing in this module deletes or rewrites that key.
 *
 * IndexedDB commits are transactional. Compare-and-swap revision checks and
 * retry-on-conflict prevent two open tabs from silently losing one another's edits.
 * The UI still receives portable Archive objects with image data URLs; at rest,
 * individual photos are Blob records, not an enormous JSON string.
 */
import type { Archive } from "../types/model";
import { STORAGE_KEY, validateArchive } from "./data";
import { verifyStagedArchive } from "./storage-staging";

export const PRIMARY_DB_NAME = "palate-storage-primary-v1";
export const PRIMARY_MODE_KEY = "palate.storage.primary.v1";
const PRIMARY_ID = "active";
type Digest = string;
interface PrimaryManifest {
  id: typeof PRIMARY_ID;
  revision: number;
  archive: Archive;
  digest: Digest;
  legacyDigest: Digest;
  savedAt: string;
}
interface PrimaryPhoto { id: string; mime: string; blob: Blob }
export interface PrimarySnapshot {
  archive: Archive;
  revision: number;
  savedAt: string;
}
const imagePattern = /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$/;

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB 요청 오류"));
  });
}
async function dbOpen(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    throw new Error("이 브라우저에서는 IndexedDB 저장을 지원하지 않습니다.");
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PRIMARY_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("manifest", { keyPath: "id" });
      db.createObjectStore("photos", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB 열기 실패"));
    req.onblocked = () => reject(new Error("다른 탭의 저장소 연결을 닫아 주세요."));
  });
}
async function digest(archive: Archive): Promise<Digest> {
  if (!crypto?.subtle) throw new Error("무결성 검증을 지원하지 않는 브라우저입니다.");
  const payload = new TextEncoder().encode(JSON.stringify(archive));
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  return Array.from(bytes, x => x.toString(16).padStart(2, "0")).join("");
}
function photoBlob(id: string, encoded: string): PrimaryPhoto {
  const match = encoded.match(imagePattern);
  if (!match) throw new Error("사진 데이터가 올바르지 않습니다.");
  const raw = atob(match[2]);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < raw.length; i += 32768) {
    const segment = raw.slice(i, i + 32768);
    const bytes = new Uint8Array(segment.length);
    for (let j = 0; j < segment.length; j++) bytes[j] = segment.charCodeAt(j);
    chunks.push(bytes);
  }
  return { id, mime: match[1], blob: new Blob(chunks, { type: match[1] }) };
}
async function photoUrl(photo: PrimaryPhoto): Promise<string> {
  const raw = new Uint8Array(await photo.blob.arrayBuffer());
  const parts: string[] = [];
  for (let i = 0; i < raw.length; i += 32768)
    parts.push(String.fromCharCode(...raw.subarray(i, i + 32768)));
  return "data:" + photo.mime + ";base64," + btoa(parts.join(""));
}
function separate(archive: Archive) {
  const meta = structuredClone(archive);
  for (const image of meta.photos) image.storage_path = "";
  return meta;
}
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("IndexedDB 트랜잭션 중단"));
    tx.onerror = () => reject(tx.error || new Error("IndexedDB 쓰기 오류"));
  });
}
async function openSnapshot(): Promise<{ manifest: PrimaryManifest; photos: PrimaryPhoto[] }> {
  const db = await dbOpen();
  try {
    const tx = db.transaction(["manifest", "photos"], "readonly");
    const [manifest, photos] = await Promise.all([
      result<PrimaryManifest | undefined>(tx.objectStore("manifest").get(PRIMARY_ID)),
      result<PrimaryPhoto[]>(tx.objectStore("photos").getAll()),
    ]);
    if (!manifest || manifest.revision < 1)
      throw new Error("활성화된 IndexedDB 데이터가 없습니다.");
    return { manifest, photos };
  } finally {
    db.close();
  }
}
async function reconstruct(manifest: PrimaryManifest, photos: PrimaryPhoto[]): Promise<Archive> {
  const archive: Archive = structuredClone(manifest.archive);
  if (photos.length !== archive.photos.length)
    throw new Error("일부 사진이 누락되었습니다. 저장소를 자동 복구하지 않습니다.");
  const imageMap = new Map(photos.map(p => [p.id, p]));
  for (const photo of archive.photos) {
    const blob = imageMap.get(photo.id);
    if (!blob) throw new Error("누락된 사진이 있습니다.");
    photo.storage_path = await photoUrl(blob);
  }
  const validated = validateArchive(archive);
  if (await digest(validated) !== manifest.digest)
    throw new Error("저장소 무결성이 일치하지 않습니다. 데이터 변경을 중단했습니다.");
  return validated;
}
function legacyArchive(): Archive {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error("기존 로컬 원본이 없습니다.");
  return validateArchive(JSON.parse(raw));
}
async function checkLegacy(currentDigest: Digest) {
  const source = legacyArchive();
  if (await digest(source) !== currentDigest) {
    throw new Error(
      "IndexedDB 활성화 이후 기존 로컬 데이터가 변경되었습니다. 자동으로 덮어쓰지 않고 저장을 중단했습니다. 별도 JSON 백업 후 충돌을 해결해 주세요.",
    );
  }
}
export function primaryEnabled(): boolean {
  return localStorage.getItem(PRIMARY_MODE_KEY) === "on";
}
export async function readPrimary(): Promise<PrimarySnapshot> {
  const { manifest, photos } = await openSnapshot();
  await checkLegacy(manifest.legacyDigest);
  return {
    archive: await reconstruct(manifest, photos),
    revision: manifest.revision,
    savedAt: manifest.savedAt,
  };
}
/** Activation only after P2-A independent staging verification. */
export async function activatePrimary(): Promise<PrimarySnapshot> {
  if (primaryEnabled()) return readPrimary();
  const original = legacyArchive();
  const copy = await verifyStagedArchive();
  const originalDigest = await digest(original);
  if (originalDigest !== copy.digest || JSON.stringify(original) !== JSON.stringify(copy.archive))
    throw new Error("기존 원본과 검증 사본이 다릅니다. 먼저 검증용 사본을 다시 만들어 주세요.");

  const prepared = original.photos.map(p => photoBlob(p.id, p.storage_path));
  const manifest: PrimaryManifest = {
    id: PRIMARY_ID,
    archive: separate(original),
    revision: 1,
    legacyDigest: originalDigest,
    digest: originalDigest,
    savedAt: new Date().toISOString(),
  };
  const db = await dbOpen();
  try {
    const tx = db.transaction(["manifest", "photos"], "readwrite");
    const done = transactionDone(tx);
    tx.objectStore("manifest").put(manifest);
    tx.objectStore("photos").clear();
    for (const photo of prepared) tx.objectStore("photos").put(photo);
    await done;
  } finally {
    db.close();
  }
  const ready = await readPrimary();
  // Do not enable a stale snapshot if another tab wrote the old key meanwhile.
  if (await digest(legacyArchive()) !== originalDigest)
    throw new Error("전환 과정에서 기존 원본이 변경되었습니다. 다른 탭을 닫고 검증을 다시 진행해 주세요.");
  localStorage.setItem(PRIMARY_MODE_KEY, "on");
  return ready;
}
/** IDB transaction does CAS against revision, never LWW. */
async function compareAndSwap(
  revision: number, archive: Archive, legacyDigest: string,
  prev: Archive,
): Promise<boolean> {
  const newDigest = await digest(archive);
  const meta: PrimaryManifest = {
    id: PRIMARY_ID, revision: revision + 1, digest: newDigest,
    legacyDigest, savedAt: new Date().toISOString(), archive: separate(archive),
  };
  const before = new Map(prev.photos.map(p => [p.id, p.storage_path]));
  const after = new Map(archive.photos.map(p => [p.id, p.storage_path]));
  const added = archive.photos.filter(p => before.get(p.id) !== p.storage_path)
    .map(p => photoBlob(p.id, p.storage_path));
  const removed = [...before.keys()].filter(id => !after.has(id));
  const db = await dbOpen();
  try {
    const tx = db.transaction(["manifest", "photos"], "readwrite");
    const done = transactionDone(tx);
    const check = tx.objectStore("manifest").get(PRIMARY_ID);
    let conflict = false;
    check.onsuccess = () => {
      const previous = check.result as PrimaryManifest | undefined;
      if (!previous || previous.revision !== revision || previous.legacyDigest !== legacyDigest) {
        conflict = true;
        return; // Read-only transaction: successful completion reports a conflict.
      }
      tx.objectStore("manifest").put(meta);
      const store = tx.objectStore("photos");
      for (const id of removed) store.delete(id);
      for (const photo of added) store.put(photo);
    };
    await done;
    return !conflict;
  } finally {
    db.close();
  }
}
export async function commitPrimary(fn: (archive: Archive) => Archive): Promise<PrimarySnapshot> {
  if (!primaryEnabled()) throw new Error("IndexedDB 모드가 활성화되지 않았습니다.");
  for (let retry = 0; retry < 3; retry++) {
    const { manifest, photos } = await openSnapshot();
    await checkLegacy(manifest.legacyDigest);
    const old = await reconstruct(manifest, photos);
    // The updater may be re-run in case of a concurrent edit in another tab.
    const next = validateArchive(fn(old));
    if (!primaryEnabled()) throw new Error("저장 모드가 변경되었습니다.");
    if (await compareAndSwap(manifest.revision, next, manifest.legacyDigest, old)) {
      return { archive: next, revision: manifest.revision + 1, savedAt: new Date().toISOString() };
    }
  }
  throw new Error("다른 탭에서 동시에 저장 중입니다. 새로고침 후 다시 시도해 주세요.");
}
