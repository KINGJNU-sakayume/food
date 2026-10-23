import type { Archive, Photo } from "../types/model.js";

/**
 * 사진 원본(WebP data URL)은 IndexedDB에 두고, localStorage의 아카이브에는 `idb:<저장 키>`만 남긴다.
 * 저장 키는 처음 저장할 때의 사진 id다. 기록을 고치면 사진 id가 새로 생기지만, 참조는 원본의
 * 저장 키를 그대로 가리키므로 끊기지 않는다.
 *
 * localStorage는 주소(kingjnu-sakayume.github.io)당 약 5MB를 같은 주소의 다른 앱과 함께 쓴다.
 * 사진을 그대로 넣으면 몇 주 만에 가득 차서 이 앱과 다른 앱의 저장이 모두 실패할 수 있다.
 *
 * 안전 규칙: 사진은 IndexedDB 저장이 끝난 뒤에야 참조로 바뀐다. 그 전까지(또는 IndexedDB를
 * 쓸 수 없는 브라우저에서는) 예전처럼 localStorage에 그대로 남는다. 화면과 JSON 백업은 항상
 * data URL이 채워진 아카이브를 쓴다.
 */

export const PHOTO_REF_PREFIX = "idb:";
const DB_NAME = "palate-photos";
const STORE = "photos";

export const PHOTO_REF_PATTERN = /^idb:[A-Za-z0-9-]{1,100}$/;
export const isPhotoRef = (path: string) => path.startsWith(PHOTO_REF_PREFIX);
export const photoRef = (key: string) => PHOTO_REF_PREFIX + key;
const refKey = (path: string) => path.slice(PHOTO_REF_PREFIX.length);

/** IndexedDB에 저장이 확인된 사진: 저장 키 → data URL */
const saved = new Map<string, string>();
let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined")
        return reject(new Error("IndexedDB unavailable"));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB blocked"));
    });
    dbPromise.catch(() => (dbPromise = undefined));
  }
  return dbPromise;
}

async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB aborted"));
  });
}

/** 아직 IndexedDB에 없는 data URL 사진 */
export function unsavedPhotos(a: Archive): Photo[] {
  return a.photos.filter(
    (p) => !isPhotoRef(p.storage_path) && saved.get(p.id) !== p.storage_path,
  );
}

/** 이 탭에서 아직 원본을 읽지 않은 참조의 저장 키 */
export function missingPhotoIds(a: Archive): string[] {
  return a.photos
    .filter((p) => isPhotoRef(p.storage_path) && !saved.has(refKey(p.storage_path)))
    .map((p) => refKey(p.storage_path));
}

/** 이 아카이브가 쓰는 저장 키 전부 (아직 옮기지 않은 사진은 자기 id로 저장될 예정) */
export function photoKeys(a: Archive): Set<string> {
  return new Set(
    a.photos.map((p) => (isPhotoRef(p.storage_path) ? refKey(p.storage_path) : p.id)),
  );
}

export async function savePhotos(photos: Photo[]): Promise<void> {
  if (!photos.length) return;
  await run("readwrite", (store) => {
    for (const p of photos) store.put(p.storage_path, p.id);
  });
  for (const p of photos) saved.set(p.id, p.storage_path);
}

export async function loadPhotos(ids: string[]): Promise<void> {
  const wanted = ids.filter((photoId) => !saved.has(photoId));
  if (!wanted.length) return;
  const found: [string, unknown][] = [];
  await run("readonly", (store) => {
    for (const photoId of wanted) {
      const req = store.get(photoId);
      req.onsuccess = () => found.push([photoId, req.result]);
    }
  });
  for (const [photoId, value] of found)
    if (typeof value === "string") saved.set(photoId, value);
}

/** 아카이브에 없는 사진 원본을 지운다 (시작할 때 한 번) */
export async function prunePhotos(keep: ReadonlySet<string>): Promise<void> {
  const keys = (await run("readonly", (store) => store.getAllKeys())) ?? [];
  const stale = keys.filter((k) => typeof k === "string" && !keep.has(k));
  if (!stale.length) return;
  await run("readwrite", (store) => {
    for (const k of stale) store.delete(k);
  });
  for (const k of stale) saved.delete(k as string);
}

/** 참조를 읽어 둔 원본으로 바꾼다. 바뀐 것이 없으면 같은 객체를 돌려준다. */
export function hydrate(a: Archive): Archive {
  const known = (path: string) => isPhotoRef(path) && saved.has(refKey(path));
  if (!a.photos.some((p) => known(p.storage_path))) return a;
  return {
    ...a,
    photos: a.photos.map((p) =>
      known(p.storage_path)
        ? { ...p, storage_path: saved.get(refKey(p.storage_path))! }
        : p,
    ),
  };
}

/** 저장용: IndexedDB에 들어간 사진만 참조로 바꾼다. */
export function dehydrate(a: Archive): Archive {
  if (!a.photos.some((p) => saved.get(p.id) === p.storage_path)) return a;
  return {
    ...a,
    photos: a.photos.map((p) =>
      saved.get(p.id) === p.storage_path
        ? { ...p, storage_path: photoRef(p.id) }
        : p,
    ),
  };
}

/** 내보내기 전에: 모든 사진을 원본으로 채운다. 읽지 못한 사진이 있으면 오류. */
export async function withAllPhotos(a: Archive): Promise<Archive> {
  await loadPhotos(missingPhotoIds(a));
  const full = hydrate(a);
  assertPortable(full);
  return full;
}

/** 파일로 주고받는 아카이브에는 이 기기 안의 사진 참조가 있으면 안 된다. */
export function assertPortable(a: Archive) {
  if (a.photos.some((p) => isPhotoRef(p.storage_path)))
    throw new Error(
      "사진 원본을 찾을 수 없는 백업입니다. 사진이 모두 들어 있는 JSON 백업을 선택해 주세요.",
    );
}
