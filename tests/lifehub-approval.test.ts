import test from "node:test";
import assert from "node:assert/strict";
import { emptyArchive, validateArchive, removeRecord } from "../src/lib/data.js";
import { approveCandidate } from "../src/lib/lifehub-approval.js";
import { enqueueCandidate } from "../src/lib/lifehub-inbox.js";
import { reconcileInbox, addLocalCandidate, readLocalInbox, rejectLocalCandidate } from "../src/lib/lifehub-local.js";

const candidate = {
  schema_version:1,
  candidate_type:"meal",
  source:"manual",
  source_ref:"local-example-003",
  idempotency_key:"palate_local_example_003",
  created_at:"2026-11-01T06:00:00Z",
  payload:{ menu_name:"돈코츠 라멘", place_name:"멘야하나", verdict:"LIKE" },
};
const review = {
  candidate_type:"meal" as const,
  menu_name:"돈코츠 라멘",
  place_name:"멘야하나",
  address:"성수동",
  eaten_at:"2026-11-01",
  verdict:"LIKE" as const,
  reorder_intent:"YES" as const,
  note:"면이 좋았어",
};
test("approving a candidate atomically writes an archive receipt and is idempotent", () => {
  const a = emptyArchive();
  assert.equal(a.records.length, 0);
  const once = approveCandidate(a, candidate, review);
  validateArchive(once.archive);
  assert.equal(once.duplicate, false);
  assert.equal(once.archive.records.length, 1);
  assert.equal(once.archive.lifehub_receipts?.[0].entity_id, once.entity_id);
  const twice = approveCandidate(once.archive, candidate, review);
  assert.equal(twice.duplicate, true);
  assert.equal(twice.archive, once.archive);
  assert.equal(twice.archive.records.length, 1);
  const deleted = removeRecord(once.archive, once.entity_id);
  validateArchive(deleted);
  assert.equal(approveCandidate(deleted, candidate, review).duplicate, true);
  assert.equal(approveCandidate(deleted, candidate, review).archive.records.length, 0);
});
test("candidate approval requires explicit date, verdict and reorder decision", () => {
  const a = emptyArchive();
  assert.throws(() => approveCandidate(a,candidate,{...review,eaten_at:""}),/확인/);
  assert.throws(() => approveCandidate(a,candidate,{...review,eaten_at:"2026-02-31"}),/확인/);
  assert.throws(() => approveCandidate(a,candidate,{...review,reorder_intent:"" as any}),/확인/);
  assert.equal(a.records.length,0);
});
test("wish candidates generate one stable wish without duplicate replay", () => {
  const a = emptyArchive();
  const wish = {
    schema_version:1,candidate_type:"wish",source:"manual",source_ref:"manual-wish-001",
    idempotency_key:"manual_wish_001",created_at:"2026-11-01T06:00:00Z",
    payload:{wish_kind:"visit_place",name:"가보고 싶은 가게"},
  };
  const once = approveCandidate(a,wish,{candidate_type:"wish",name:"가보고 싶은 가게",address:"서울"});
  assert.equal(once.archive.wishes.length,1);
  assert.equal(once.archive.places.length,1);
  assert.equal(approveCandidate(once.archive,wish,{candidate_type:"wish",name:"다른 곳",address:""}).duplicate,true);
});
test("local inbox imports only candidates, never creates a meal and reconciles committed receipt", () => {
  const db = new Map<string,string>();
  const storage = {
    getItem(key:string){ return db.get(key) ?? null; },
    setItem(key:string,value:string){ db.set(key,value); },
  };
  const a=emptyArchive();
  const before = addLocalCandidate(a,candidate,storage);
  assert.equal(before.result,"inserted");
  assert.equal(a.records.length,0);
  assert.equal(addLocalCandidate(a,candidate,storage).result,"duplicate");
  assert.equal(readLocalInbox(a,storage).length,1);
  const approved=approveCandidate(a,candidate,review);
  const after=readLocalInbox(approved.archive,storage);
  assert.equal(after[0].status,"confirmed");
  assert.equal(after[0].confirmed_entity_id,approved.entity_id);
  assert.equal(reconcileInbox(approved.archive, before.entries)[0].status,"confirmed");
});
test("rejecting a local inbox candidate never changes the Archive",()=>{
  const db=new Map<string,string>();
  const storage={getItem:(k:string)=>db.get(k)??null,setItem:(k:string,v:string)=>{db.set(k,v);}};
  const a=emptyArchive();
  addLocalCandidate(a,candidate,storage);
  rejectLocalCandidate(a,"manual:palate_local_example_003",storage);
  assert.equal(readLocalInbox(a,storage)[0].status,"rejected");
  assert.equal(a.records.length,0);
});

test("same-name branches with different addresses stay separate and ambiguous names require review", () => {
  const first = approveCandidate(emptyArchive(), candidate, review);
  const secondCandidate = { ...candidate, idempotency_key: "palate_local_example_004" };
  const second = approveCandidate(first.archive, secondCandidate, { ...review, address: "홍대" });
  assert.equal(second.archive.places.length, 2);
  assert.notEqual(second.archive.records[0].place_id, second.archive.records[1].place_id);
  const thirdCandidate = { ...candidate, idempotency_key: "palate_local_example_005" };
  assert.throws(() => approveCandidate(second.archive, thirdCandidate, { ...review, address: "" }), /주소나 지점/);
});
