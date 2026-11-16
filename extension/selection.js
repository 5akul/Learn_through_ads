// Decides which card comes next and computes the streak.
// Pure functions only (no browser APIs), so they can be tested on their own.
(function (root) {
  const LTA = root.LTA || (root.LTA = {});

  // Cards with a higher exam weight come up more often.
  const WEIGHT = { high: 3, medium: 2, low: 1 };

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  const DAY = 24 * 3600 * 1000;
  // A card answered wrong comes back after 1 day, then 3, 7 and 21 days.
  // Each correct answer moves it one step on; a wrong answer starts again at 1 day.
  const INTERVALS = [1, 3, 7, 21];

  // Which cards are due for repetition right now. Returns a Set of card ids.
  // events must be in time order (they are, because they are only ever appended).
  LTA.dueCardIds = function (events, now) {
    const state = new Map(); // card id -> { step, dueAt }
    for (const e of events) {
      if (e.type !== "answer" || typeof e.ok !== "boolean") continue;
      const s = state.get(e.id);
      if (!e.ok) {
        state.set(e.id, { step: 0, dueAt: startOfDay(e.t) + INTERVALS[0] * DAY });
      } else if (s && e.t >= s.dueAt) {
        // Correct, and it was due: move one step on, or finish after the last step.
        const step = s.step + 1;
        if (step >= INTERVALS.length) state.delete(e.id);
        else state.set(e.id, { step, dueAt: startOfDay(e.t) + INTERVALS[step] * DAY });
      }
    }
    const due = new Set();
    for (const [id, s] of state) if (now >= s.dueAt) due.add(id);
    return due;
  };

  function weightedPick(pool, rand) {
    const total = pool.reduce((sum, c) => sum + (WEIGHT[c.exam_weight] || 1), 0);
    let r = rand() * total;
    for (const c of pool) {
      r -= WEIGHT[c.exam_weight] || 1;
      if (r < 0) return c;
    }
    return pool[pool.length - 1];
  }

  // cards:    all loaded cards
  // events:   the local history, e.g. { type: "show", id, t } and { type: "answer", id, t, ok, ms }
  // settings: { currentChapter: { psychology: 4, ... } }
  //
  // The mix: 50 % cards from the current chapter, 25 % repetitions of cards answered wrong,
  //          25 % anything from all subjects. An empty group passes its share on to the next one.
  // Rules:   no card twice on the same day, no card type twice in a row.
  //          If the rules leave nothing over (few cards), they are relaxed one by one.
  LTA.pickCard = function (cards, events, now, settings, rand) {
    settings = settings || {};
    rand = rand || Math.random;
    if (!cards.length) return null;

    const today = startOfDay(now);
    const shownToday = new Set(
      events.filter((e) => e.type === "show" && e.t >= today).map((e) => e.id)
    );
    let lastType = null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "show") {
        const last = cards.find((c) => c.id === events[i].id);
        lastType = last ? last.type : null;
        break;
      }
    }

    const current = settings.currentChapter || {};
    const due = LTA.dueCardIds(events, now);
    const groups = {
      fresh: cards.filter((c) => current[c.subject] === c.chapter),
      review: cards.filter((c) => due.has(c.id)),
      any: cards,
    };
    const roll = rand();
    const order = roll < 0.5 ? ["fresh", "review", "any"] : roll < 0.75 ? ["review", "fresh", "any"] : ["any"];

    const rules = [
      (c) => !shownToday.has(c.id) && c.type !== lastType,
      (c) => !shownToday.has(c.id),
      (c) => c.type !== lastType,
      () => true,
    ];
    for (const rule of rules) {
      for (const name of order) {
        const pool = groups[name].filter(rule);
        if (pool.length) return weightedPick(pool, rand);
      }
    }
    return null;
  };

  // Number of days in a row (ending today or yesterday) with at least one answered card.
  LTA.streak = function (events, now) {
    const days = new Set(
      events.filter((e) => e.type === "answer").map((e) => startOfDay(e.t))
    );
    let day = startOfDay(now);
    if (!days.has(day)) {
      // Today not done yet: the streak from yesterday still counts.
      day = startOfDay(day - 12 * 3600 * 1000);
      if (!days.has(day)) return 0;
    }
    let count = 0;
    while (days.has(day)) {
      count++;
      // Step back one calendar day (12 h back, then to midnight, safe with daylight saving).
      day = startOfDay(day - 12 * 3600 * 1000);
    }
    return count;
  };

  // Light check so a broken card never crashes the overlay.
  // The full check against card.schema.json runs in tools/check_cards.py.
  LTA.isUsableCard = function (c) {
    if (!c || typeof c.id !== "string" || typeof c.hook !== "string" || typeof c.answer !== "string") {
      return false;
    }
    switch (c.type) {
      case "hook_reveal":
        return true;
      case "find_error":
        return Array.isArray(c.lines) && Number.isInteger(c.error_line) &&
          c.error_line >= 1 && c.error_line <= c.lines.length;
      case "cloze":
        return Array.isArray(c.options) && c.options.length === 2;
      case "estimate":
        return !!c.estimate && typeof c.estimate.correct === "number";
      case "variables":
        return typeof c.iv === "string" && typeof c.dv === "string";
      default:
        return false;
    }
  };
})(typeof self !== "undefined" ? self : globalThis);
