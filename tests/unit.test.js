// Tests for the card choice and the streak. Run: node tests/unit.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = { self: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/selection.js"), "utf8"), ctx);
const { pickCard, streak, isUsableCard, dueCardIds } = ctx.self.LTA;

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
  for (let i = 0; i < 50; i++) assert.equal(pickCard(cards, events, now).id, "b");
});

test("a card seen yesterday may come again", () => {
  const cards = [card("a", "cloze")];
  assert.equal(pickCard(cards, [{ type: "show", id: "a", t: now - DAY }], now).id, "a");
});

test("no card type twice in a row", () => {
  const cards = [card("a", "cloze"), card("b", "cloze"), card("c", "estimate")];
  const events = [{ type: "show", id: "a", t: now - DAY }];
  for (let i = 0; i < 50; i++) assert.equal(pickCard(cards, events, now).id, "c");
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

// Returns the given numbers one after another instead of real random numbers.
const fixed = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
const mixCards = [
  { ...card("fresh", "cloze"), subject: "computer_science", chapter: 3 },
  { ...card("wrong", "estimate"), subject: "economics", chapter: 9 },
  { ...card("other", "variables"), subject: "psychology", chapter: 2 },
];
const mixSettings = { currentChapter: { computer_science: 3 } };
const wrongYesterday = [{ type: "answer", id: "wrong", t: now - DAY, ok: false }];

test("the mix: 50 % current chapter, 25 % repetition, 25 % anything", () => {
  assert.equal(pickCard(mixCards, wrongYesterday, now, mixSettings, fixed(0.2, 0)).id, "fresh");
  assert.equal(pickCard(mixCards, wrongYesterday, now, mixSettings, fixed(0.6, 0)).id, "wrong");
  assert.equal(pickCard(mixCards, wrongYesterday, now, mixSettings, fixed(0.9, 0.99)).id, "other");
  const count = { fresh: 0, wrong: 0, other: 0 };
  for (let i = 0; i < 6000; i++) count[pickCard(mixCards, wrongYesterday, now, mixSettings).id]++;
  // "anything" (25 %) is shared equally by the three cards, so: 58 %, 33 %, 8 %.
  assert.ok(Math.abs(count.fresh / 6000 - 0.583) < 0.03, JSON.stringify(count));
  assert.ok(Math.abs(count.wrong / 6000 - 0.333) < 0.03, JSON.stringify(count));
  assert.ok(Math.abs(count.other / 6000 - 0.083) < 0.02, JSON.stringify(count));
});

test("an empty group passes its share on", () => {
  // no chapter chosen: the 50 % for the current chapter go to repetitions
  assert.equal(pickCard(mixCards, wrongYesterday, now, {}, fixed(0.2, 0)).id, "wrong");
  // nothing to repeat: the 25 % for repetitions go to the current chapter
  assert.equal(pickCard(mixCards, [], now, mixSettings, fixed(0.6, 0)).id, "fresh");
});

test("the daily rule beats the mix", () => {
  const events = [...wrongYesterday, { type: "show", id: "fresh", t: now - 1000 }, { type: "show", id: "wrong", t: now - 500 }];
  assert.equal(pickCard(mixCards, events, now, mixSettings, fixed(0.2, 0)).id, "other");
});

test("wrong cards come back after 1, 3, 7 and 21 days", () => {
  const at = (d, hour = 15) => new Date(2026, 5, 1 + d, hour, 0).getTime();
  const ans = (d, ok) => ({ type: "answer", id: "x", t: at(d), ok });
  const due = (events, d, hour) => dueCardIds(events, at(d, hour)).has("x");

  assert.equal(due([ans(0, true)], 5), false, "a card never answered wrong is not repeated");
  let events = [ans(0, false)];
  assert.equal(due(events, 0, 23), false, "not on the same day");
  assert.equal(due(events, 1, 8), true, "next day");
  events.push(ans(1, true));
  assert.equal(due(events, 3), false);
  assert.equal(due(events, 4, 8), true, "3 days later");
  events.push(ans(4, true));
  assert.equal(due(events, 10), false);
  assert.equal(due(events, 11, 8), true, "7 days later");
  events.push(ans(11, true));
  assert.equal(due(events, 31), false);
  assert.equal(due(events, 32, 8), true, "21 days later");
  events.push(ans(32, true));
  assert.equal(due(events, 200), false, "finished after the last step");

  // wrong again: starts over at 1 day
  events = [ans(0, false), ans(1, true), ans(4, false)];
  assert.equal(due(events, 5, 8), true);
  // a correct answer before the card was due does not count as a repetition
  events = [ans(0, false), ans(1, true), ans(2, true)];
  assert.equal(due(events, 4, 8), true);
  assert.equal(due(events, 3), false);
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
