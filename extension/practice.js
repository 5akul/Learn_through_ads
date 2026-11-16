// Manual mode: ten cards in a row on their own page, without YouTube.
(async function () {
  const LTA = self.LTA;
  const SESSION_SIZE = 10;
  const stage = document.getElementById("stage");

  const all = ((await chrome.runtime.sendMessage({ type: "getCards" }).catch(() => [])) || [])
    .filter(LTA.isUsableCard);
  if (!all.length) {
    stage.textContent = "No cards found.";
    return;
  }

  let overlay = null;
  let seen, index, answered, correct, total;

  const handlers = {
    onAnswer(card, ok, ms) {
      LTA.store.addEvent({ type: "answer", id: card.id, t: Date.now(), ok, ms });
      answered++;
      if (ok) correct++;
    },
    onRate(card, value) {
      LTA.store.setRating(card.id, value);
    },
    onNext() {
      if (index >= total) showSummary();
      else nextCard();
    },
    onBack() {},
  };

  async function nextCard() {
    const [events, settings] = await Promise.all([LTA.store.getEvents(), LTA.store.getSettings()]);
    const now = Date.now();
    // No card twice within one session.
    const left = all.filter((c) => !seen.has(c.id));
    const card = LTA.pickCard(left, events, now, settings);
    if (!card) return showSummary();
    seen.add(card.id);
    index++;
    overlay.showCard(card, { streak: LTA.streak(events, now), position: { index, total } });
    LTA.store.addEvent({ type: "show", id: card.id, t: now });
  }

  function start() {
    seen = new Set();
    index = 0;
    answered = 0;
    correct = 0;
    total = Math.min(SESSION_SIZE, all.length);
    document.getElementById("sub").textContent = `${total} cards in a row, no YouTube needed.`;
    stage.replaceChildren();
    overlay = new LTA.Overlay(stage, handlers, { layout: "page" });
    nextCard();
  }

  function showSummary() {
    if (overlay) overlay.destroy();
    overlay = null;
    const box = document.createElement("div");
    box.className = "summary";
    const big = document.createElement("div");
    big.className = "big";
    big.textContent = `${correct} of ${total}`;
    const text = document.createElement("p");
    const skipped = total - answered;
    text.textContent = "correct" + (skipped ? ` · ${skipped} skipped` : "");
    const row = document.createElement("div");
    row.className = "buttons";
    const again = document.createElement("button");
    again.className = "btn primary";
    again.textContent = total < SESSION_SIZE ? `${total} more cards` : "10 more cards";
    again.addEventListener("click", start);
    const done = document.createElement("button");
    done.className = "btn";
    done.textContent = "Done";
    done.addEventListener("click", () => window.close());
    row.append(again, done);
    box.append(big, text, row);
    stage.replaceChildren(box);
  }

  start();
})();
