import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { emptyArchive } from "../src/lib/data.js";
import { boardBodyForHash, buildBoardTiles, cut, type BoardManifest } from "../src/lib/board-tiles.js";
import { sampleArchive, SAMPLE_NOW } from "./board-fixture.js";

// Compiled to work/test-build/tests; the vendored board files live in the repo's tests/vendor.
const vendor = (f: string) => new URL("../../../tests/vendor/" + f, import.meta.url).href;
const { validateManifest } = await import(vendor("board-schema.mjs")) as {
  validateManifest: (m: unknown, p: unknown) => { ok: boolean; errors: Array<{ id: unknown; message: string }>; tiles: Array<{ id: string; size: string; show: boolean; sizes: string[] }> };
};
const { CONFIG } = await import(vendor("board-config.mjs")) as { CONFIG: { imageOrigins: string[]; linkOrigins: string[] } };
const policy = { imageOrigins: CONFIG.imageOrigins, linkOrigins: CONFIG.linkOrigins };
const sampleUrl = new URL("../../../board/sample.json", import.meta.url);

/** ok alone proves nothing: check that no tile was dropped and no error was reported. */
function assertValid(m: BoardManifest) {
  const v = validateManifest(m, policy);
  assert.deepEqual(v.errors, []);
  assert.equal(v.tiles.length, m.tiles.length);
  return v;
}

test("sample output matches the generator and passes spec v1 with policy", () => {
  const manifest = buildBoardTiles(sampleArchive(), SAMPLE_NOW);
  if (process.env.UPDATE_BOARD_SAMPLE) writeFileSync(sampleUrl, JSON.stringify(manifest, null, 2) + "\n");
  const file = JSON.parse(readFileSync(sampleUrl, "utf8"));
  assert.deepEqual(file, manifest);
  const v = assertValid(file);
  assert.deepEqual(v.tiles.map((t) => t.id), ["recent", "last", "again", "wish"]);
  assert.ok(Buffer.byteLength(JSON.stringify(file)) < 64 * 1024);
});

test("tile ids, sizes, initial size and default are fixed", () => {
  const v = assertValid(buildBoardTiles(sampleArchive(), SAMPLE_NOW));
  const by = Object.fromEntries(v.tiles.map((t) => [t.id, t]));
  assert.deepEqual(by.recent.sizes, ["2x1", "4x1"]); assert.equal(by.recent.size, "2x1"); assert.equal(by.recent.show, true);
  assert.deepEqual(by.last.sizes, ["2x1", "4x1"]); assert.equal(by.last.size, "2x1"); assert.equal(by.last.show, false);
  assert.deepEqual(by.again.sizes, ["2x1", "2x2"]); assert.equal(by.again.size, "2x2"); assert.equal(by.again.show, false);
  assert.deepEqual(by.wish.sizes, ["2x1", "2x2"]); assert.equal(by.wish.size, "2x2"); assert.equal(by.wish.show, false);
});

test("recent: newest first, one cell per menu, letter cells without src", () => {
  const m = buildBoardTiles(sampleArchive(), SAMPLE_NOW);
  const data = m.tiles.find((t) => t.id === "recent")!.data as { items: Array<{ title: string; cover: Record<string, unknown> }> };
  assert.equal(data.items[0].title, "가상 김치찌개");
  assert.equal(data.items.length, 6);
  for (const it of data.items) assert.deepEqual(Object.keys(it.cover), ["mono"]);
  const again = m.tiles.find((t) => t.id === "again")!.data as { rows: Array<{ title: string; value: string }> };
  assert.deepEqual(again.rows.map((r) => r.value), ["11/7", "11/3"]);
});

test("dates are written as dates, never relative words", () => {
  const text = JSON.stringify(buildBoardTiles(sampleArchive(), SAMPLE_NOW));
  assert.ok(!/어제|오늘|그제|일 전/.test(text));
  const a = sampleArchive(); a.wishes[2].created_at = "2025-12-31T01:00:00.000Z";
  assert.match(JSON.stringify(buildBoardTiles(a, SAMPLE_NOW)), /"25\/12\/31"/);
});

test("empty archive gives no tiles, wishes only give the wish tile", () => {
  const empty = buildBoardTiles(emptyArchive(), SAMPLE_NOW);
  assert.deepEqual(empty.tiles, []);
  assertValid(empty);
  const a = sampleArchive(); a.records = [];
  const only = buildBoardTiles(a, SAMPLE_NOW);
  assert.deepEqual(only.tiles.map((t) => t.id), ["wish"]);
  assertValid(only);
  const b = sampleArchive(); b.wishes = [];
  const w = buildBoardTiles(b, SAMPLE_NOW).tiles.find((t) => t.id === "wish")!.data as { rows: Array<{ muted?: boolean }> };
  assert.equal(w.rows[0].muted, true);
  assertValid(buildBoardTiles(b, SAMPLE_NOW));
});

test("long and blank text is cut or left out", () => {
  const a = sampleArchive();
  a.menus[0].name = "가".repeat(200);
  a.records[0].short_note = "   ";
  a.places[0].name = "나".repeat(200);
  a.wishes[0].created_at = "not a date";
  const m = buildBoardTiles(a, SAMPLE_NOW);
  assertValid(m);
  const last = m.tiles.find((t) => t.id === "last")!.data as Record<string, string>;
  assert.ok(last.title.length <= 160);
  assert.equal(last.sub, "11/7");
  const walk = (v: unknown) => {
    if (typeof v === "string") assert.ok(v.trim() === v && v !== "", "no empty/blank string: " + JSON.stringify(v));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(m.tiles);
  const wishRows = (m.tiles.find((t) => t.id === "wish")!.data as { rows: Array<Record<string, unknown>> }).rows;
  assert.ok(wishRows.some((r) => r.title === "가상 피자" && !("value" in r)), "bad date → value left out");
  assert.equal(cut("가".repeat(31), 30).length, 30);
  assert.equal(cut("😀".repeat(20), 5).length <= 5, true);
});

test("same input gives the same output; hash ignores generated_at only", () => {
  const a = sampleArchive();
  assert.deepEqual(buildBoardTiles(a, SAMPLE_NOW), buildBoardTiles(sampleArchive(), SAMPLE_NOW));
  const later = buildBoardTiles(a, new Date(SAMPLE_NOW.getTime() + 60_000));
  assert.equal(boardBodyForHash(later), boardBodyForHash(buildBoardTiles(a, SAMPLE_NOW)));
  a.records[0].verdict = "DISLIKE";
  assert.notEqual(boardBodyForHash(buildBoardTiles(a, SAMPLE_NOW)), boardBodyForHash(later));
});
