/**
 * PALATE P2 / Phase A: explicit, read-only-from-source IndexedDB staging.
 *
 * The existing localStorage key remains authoritative. This module never
 * removes, overwrites or switches it. The staging store is NOT a backup:
 * it shares the same browser origin and may be evicted with site data.
 */
import type { Archive } from "../types/model";
import { STORAGE_KEY, validateArchive } from "./data";

export const STAGING_DB_NAME = "palate-storage-stage-v1";
const DB_VERSION = 1;
const CURRENT = "candidate";
const PHOTO_DATA_URL = /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$/;

interface StagedPhoto {
  id: string;
  blob: Blob;
  mime: string;
}
interface StagedManifest {
  id: typeof CURRENT;
  version: 1;
  sourceDigest: string;
  copiedAt: string;
  photoCount: number;
  archive: Archive;
}
export interface StagingReport {
  sourceDigest: string;
  copiedAt: string;
  recordCount: number;
  photoCount: number;
  originalBytes: number;
  estimatedQuota?: number;
  estimatedUsage?: number;
}
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB 읽기 오류"));
  });
}
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("이 브라우저에서 IndexedDB를 사용할 수 없습니다.");
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STAGING_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("manifest"))
        db.createObjectStore("manifest", { keyPath: "id" });
      if (!db.objectStoreNames.contains("photos"))
        db.createObjectStore("photos", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB를 열 수 없습니다."));
    request.onblocked = () =>
      reject(new Error("다른 탭에서 이전 저장소를 사용 중입니다. 탭을 닫고 다시 시도해 주세요."));
  });
}
async function checksum(archive: Archive): Promise<string> {
  if (!crypto?.subtle) throw new Error("이 브라우저에서 무결성 검증을 지원하지 않습니다.");
  const bytes = new TextEncoder().encode(JSON.stringify(archive));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, n => n.toString(16).padStart(2, "0")).join("");
}
function toBlob(path: string, id: string): StagedPhoto {
  const match = PHOTO_DATA_URL.exec(path);
  if (!match) throw new Error("사진 형식을 확인할 수 없습니다.");
  const binary = atob(match[2]);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < binary.length; i += 32768) {
    const chunk = binary.slice(i, i + 32768);
    const bytes = new Uint8Array(chunk.length);
    for (let j = 0; j < chunk.length; j++) bytes[j] = chunk.charCodeAt(j);
    chunks.push(bytes);
  }
  return { id, mime: match[1], blob: new Blob(chunks, { type: match[1] }) };
}
async function toDataUrl(photo: StagedPhoto): Promise<string> {
  const bytes = new Uint8Array(await photo.blob.arrayBuffer());
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 32768)
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return "data:" + photo.mime + ";base64," + btoa(parts.join(""));
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 저장 오류"));
    transaction.onabort = () => reject(transaction.error || new Error("저장 공간 부족 또는 저장 취소"));
  });
}

/** Read the staged copy and verify that every field and image round-trips. */
export async function verifyStagedArchive(): Promise<{
  archive: Archive;
  digest: string;
  copiedAt: string;
}> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(["manifest", "photos"], "readonly");
    const manifestPromise = requestResult(tx.objectStore("manifest").get(CURRENT)) as Promise<StagedManifest | undefined>;
    const photosPromise = requestResult(tx.objectStore("photos").getAll()) as Promise<StagedPhoto[]>;
    const [manifest, storedPhotos] = await Promise.all([manifestPromise, photosPromise]);
    if (!manifest || manifest.version !== 1)
      throw new Error("검증할 IndexedDB 사본이 없습니다.");
    if (storedPhotos.length !== manifest.photoCount)
      throw new Error("사진 개수가 원본과 일치하지 않습니다.");
    const byId = new Map(storedPhotos.map(p => [p.id, p]));
    const copy: Archive = structuredClone(manifest.archive);
    for (const photo of copy.photos) {
      const blob = byId.get(photo.id);
      if (!blob) throw new Error("사본에서 누락된 사진이 있습니다.");
      photo.storage_path = await toDataUrl(blob);
    }
    const restored = validateArchive(copy);
    const digest = await checksum(restored);
    if (digest !== manifest.sourceDigest)
      throw new Error("사본 무결성 검증에 실패했습니다. 원본은 그대로 유지됩니다.");
    return { archive: restored, digest, copiedAt: manifest.copiedAt };
  } finally {
    db.close();
  }
}

/**
 * Explicit staging only. Never called on app startup or on normal writes.
 * Checks that the source has not changed across the asynchronous operation.
 * The former staged candidate, if any, is replaced atomically.
 */
export async function stageLegacyArchive(
  storage: Pick<Storage, "getItem"> = localStorage,
): Promise<StagingReport> {
  const originalRaw = storage.getItem(STORAGE_KEY);
  if (!originalRaw)
    throw new Error("아직 저장된 아카이브가 없습니다. 첫 기록을 저장한 뒤 진행해 주세요.");
  const original = validateArchive(JSON.parse(originalRaw));
  const originalDigest = await checksum(original);
  const staged: Archive = structuredClone(original);
  const photos = original.photos.map(photo => toBlob(photo.storage_path, photo.id));
  staged.photos.forEach(photo => { photo.storage_path = ""; });
  if (storage.getItem(STORAGE_KEY) !== originalRaw)
    throw new Error("사본 준비 중 원본이 변경되었습니다. 다시 시도해 주세요.");

  const copiedAt = new Date().toISOString();
  const manifest: StagedManifest = {
    id: CURRENT, version: 1, copiedAt, sourceDigest: originalDigest,
    photoCount: photos.length, archive: staged,
  };
  const db = await openDatabase();
  try {
    const tx = db.transaction(["manifest", "photos"], "readwrite");
    const done = completed(tx);
    tx.objectStore("manifest").put(manifest);
    const imageStore = tx.objectStore("photos");
    imageStore.clear();
    for (const photo of photos) imageStore.put(photo);
    await done;
  } finally {
    db.close();
  }
  const verified = await verifyStagedArchive();
  if (verified.digest !== originalDigest ||
      JSON.stringify(verified.archive) !== JSON.stringify(original) ||
      storage.getItem(STORAGE_KEY) !== originalRaw) {
    throw new Error("사본 확인 중 데이터가 달라졌습니다. 기존 localStorage 원본은 보존했습니다.");
  }
  let estimatedQuota: number | undefined;
  let estimatedUsage: number | undefined;
  try {
    const estimate = await navigator.storage?.estimate();
    estimatedQuota = estimate?.quota;
    estimatedUsage = estimate?.usage;
  } catch { /* Estimate is advisory; verification already succeeded. */ }
  return {
    copiedAt, sourceDigest: originalDigest,
    recordCount: original.records.length,
    photoCount: original.photos.length,
    originalBytes: new Blob([originalRaw]).size,
    estimatedQuota, estimatedUsage,
  };
}
