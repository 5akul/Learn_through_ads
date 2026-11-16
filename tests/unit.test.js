// Tests for the card choice and the streak. Run: node tests/unit.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = { self: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/selection.js"), "utf8"), ctx);
const { pickCard, streak, isUsableCard } = ctx.self.LTA;

const DAY = 24 * 3600 * 1000;
const now = new Date(2026, 10, 16, 18, 0).getTime();
const card = (id, type, w = "medium") => ({ id, type, exam_weight: w, hook: "h", answer: "a" });
let failed = 0;
function test(name, fn) {
  try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "\n     ", e.message); }
}

test("no card twice on the same day", () => {
  const cards = [card("a", "cloze"), card("b", "estimate")];
  const events = [{ type: "show", id: "a", t: now - 1000 }];
  for (let i = 0; i < 50; i++) assert.equal(pickCard(cards, events, now, Math.random).id, "b");
});

test("a card seen yesterday may come again", () => {
  const cards = [card("a", "cloze")];
  assert.equal(pickCard(cards, [{ type: "show", id: "a", t: now - DAY }], now).id, "a");
});

test("no card type twice in a row", () => {
  const cards = [card("a", "cloze"), card("b", "cloze"), card("c", "estimate")];
  const events = [{ type: "show", id: "a", t: now - DAY }];
  for (let i = 0; i < 50; i++) assert.equal(pickCard(cards, events, now, Math.random).id, "c");
});

test("rules are relaxed instead of showing nothing", () => {
  const cards = [card("a", "cloze")];
  const events = [{ type: "show", id: "a", t: now - 1000 }];
  assert.equal(pickCard(cards, events, now).id, "a");
});

test("empty card list gives null", () => {
  assert.equal(pickCard([], [], now), null);
});

test("high exam weight comes up about three times as often as low", () => {
  const cards = [card("h", "cloze", "high"), card("l", "estimate", "low")];
  let high = 0;
  for (let i = 0; i < 4000; i++) if (pickCard(cards, [], now).id === "h") high++;
  assert.ok(high > 2800 && high < 3200, `high was picked ${high} of 4000 times`);
});

test("streak counts days in a row", () => {
  const ans = (t) => ({ type: "answer", id: "x", t, ok: true });
  assert.equal(streak([], now), 0);
  assert.equal(streak([ans(now)], now), 1);
  assert.equal(streak([ans(now), ans(now - DAY), ans(now - 2 * DAY)], now), 3);
  // today not done yet: yesterday's streak still counts
  assert.equal(streak([ans(now - DAY), ans(now - 2 * DAY)], now), 2);
  // a gap breaks it
  assert.equal(streak([ans(now), ans(now - 2 * DAY)], now), 1);
  assert.equal(streak([ans(now - 2 * DAY)], now), 0);
  // shown cards without an answer do not count
  assert.equal(streak([{ type: "show", id: "x", t: now }], now), 0);
});

test("broken cards are filtered out", () => {
  assert.equal(isUsableCard({ ...card("a", "find_error"), lines: ["x", "y"], error_line: 3 }), false);
  assert.equal(isUsableCard({ ...card("a", "find_error"), lines: ["x", "y"], error_line: 2 }), true);
  assert.equal(isUsableCard({ ...card("a", "cloze"), options: ["x"] }), false);
  assert.equal(isUsableCard({ ...card("a", "unknown_type") }), false);
  assert.equal(isUsableCard(null), false);
});

if (failed) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log("\nall unit tests passed");
