/**
 * One Life Hub round trip shared by the app start and the inbox page:
 * push outcomes → pull open candidates → save what the owner already approved in a Claude card
 * (auto-apply on, no last check requested, complete for PALATE) → send those receipts.
 *
 * Every save goes through the normal Archive commit with its receipt in the same transaction, so a retry
 * or a second tab can never create a second meal (approveCandidate returns the existing receipt).
 */
import type { Archive } from "../types/model.js";
import { approveCandidate, reviewFromCandidate } from "./lifehub-approval.js";
import { completeLocalCandidate } from "./lifehub-local.js";
import { pushOutcomes, syncWithLifeHub, type RemoteDeps, type SyncSummary } from "./lifehub-remote.js";

export type ArchiveSave = (fn: (archive: Archive) => Archive) => Promise<boolean>;
export interface RoundTrip extends SyncSummary {
  /** Saved automatically in this round trip. */
  applied: number;
  /** The archive after the automatic saves (the input archive when nothing was saved). */
  archive: Archive;
}

let running: Promise<RoundTrip> | null = null;

/** Only one round trip at a time (app start and the inbox page may both ask). */
export function runLifeHubSync(archive: Archive, save: ArchiveSave, deps: RemoteDeps): Promise<RoundTrip> {
  running ??= roundTrip(archive, save, deps).finally(() => { running = null; });
  return running;
}

async function roundTrip(archive: Archive, save: ArchiveSave, deps: RemoteDeps): Promise<RoundTrip> {
  const summary = await syncWithLifeHub(archive, deps);
  let current = archive;
  let applied = 0;
  for (const item of summary.autoApply) {
    const review = reviewFromCandidate(item.candidate);
    if (!review) continue;
    let saved: { archive: Archive; entity_id: string } | undefined;
    let ok = false;
    try {
      ok = await save((a) => { const result = approveCandidate(a, item.candidate, review); saved = result; return result.archive; });
    } catch { ok = false; }
    if (!ok || !saved) continue;
    current = saved.archive;
    try { completeLocalCandidate(current, item.key, saved.entity_id, deps.storage); } catch { /* the Archive receipt is authoritative */ }
    applied++;
  }
  if (applied) {
    const pushed = await pushOutcomes(current, deps).catch(() => null);
    if (pushed) { summary.receiptsSent += pushed.receiptsSent; summary.waiting = pushed.waiting; }
  }
  return { ...summary, applied, archive: current };
}
