// The card window that sits on top of the YouTube player.
// It lives in a "shadow root", so YouTube's styles cannot change how it looks and ours cannot break YouTube.
(function (root) {
  const LTA = root.LTA || (root.LTA = {});

  const SUBJECTS = {
    computer_science: "Computer Science",
    mathematics: "Mathematics",
    economics: "Economics",
    psychology: "Psychology",
  };

  const CSS = `
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .panel {
      height: 100%; overflow-y: auto; padding: 1em 1.1em;
      display: flex; flex-direction: column; gap: 0.8em;
      background: rgba(15, 15, 15, 0.95); color: #f1f1f1;
      border-radius: 0 0 14px 0; box-shadow: 4px 4px 24px rgba(0, 0, 0, 0.5);
      font: 400 clamp(14px, 3.6cqw, 22px)/1.4 Roboto, Arial, sans-serif;
    }
    .panel.page { height: auto; min-height: 18em; border-radius: 14px; }
    .top { display: flex; justify-content: space-between; gap: 0.5em; font-size: 0.7em; color: #9a9a9a; }
    .hook { font-size: 1.15em; font-weight: 600; line-height: 1.35; }
    .hint { font-size: 0.85em; color: #9a9a9a; }
    .buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5em; }
    .btn {
      font: inherit; font-weight: 600; font-size: 0.9em; padding: 0.7em; border: 0; border-radius: 0.5em;
      background: #3a3a3a; color: #f1f1f1; cursor: pointer;
    }
    .btn:hover:not(:disabled) { filter: brightness(1.15); }
    .btn:disabled { cursor: default; }
    .footer .btn:disabled { opacity: 0.55; }
    .btn.primary { background: #f1f1f1; color: #0f0f0f; }
    .btn.ok { background: #3ea66b; color: #fff; }
    .btn.bad { background: #d9534f; color: #fff; }
    .btn.wide { grid-column: 1 / -1; }
    .code {
      background: #0b0b0b; border: 1px solid #2e2e2e; border-radius: 0.5em; padding: 0.25em 0;
      font: 0.8em/1.4 ui-monospace, Menlo, Consolas, monospace;
    }
    .code button {
      display: flex; gap: 0.8em; width: 100%; text-align: left; white-space: pre-wrap;
      background: none; border: 0; color: inherit; font: inherit; padding: 0.35em 0.8em; cursor: pointer;
    }
    .code button:hover:not(:disabled) { background: #222; }
    .code button:disabled { cursor: default; }
    .code .num { color: #777; flex: none; width: 1.4em; }
    .code button.ok { background: rgba(62, 166, 107, 0.3); }
    .code button.bad { background: rgba(217, 83, 79, 0.3); }
    .slider-value { font-size: 1.5em; font-weight: 700; text-align: center; }
    input[type=range] { width: 100%; accent-color: #f1f1f1; }
    .reveal { border-top: 1px solid #2e2e2e; padding-top: 0.7em; display: flex; flex-direction: column; gap: 0.35em; }
    .verdict { font-weight: 700; }
    .verdict.ok { color: #3ea66b; }
    .verdict.bad { color: #e06c68; }
    .label { color: #9a9a9a; }
    .source { font-size: 0.8em; color: #9a9a9a; }
    .rate { display: flex; align-items: center; gap: 0.4em; flex-wrap: wrap; font-size: 0.8em; color: #9a9a9a; margin-top: 0.3em; }
    .rate button { font-size: 1.1em; padding: 0.15em 0.5em; border: 0; border-radius: 0.4em; background: #3a3a3a; cursor: pointer; }
    .rate button.chosen { outline: 2px solid #f1f1f1; }
    .rate .more { margin-left: auto; background: none; color: #9a9a9a; text-decoration: underline; font-size: 1em; }
    .footer { margin-top: auto; display: flex; flex-direction: column; gap: 0.35em; }
    .bar { height: 4px; background: #2e2e2e; border-radius: 2px; overflow: hidden; }
    .bar div { height: 100%; width: 0; background: #ffcc00; transition: width 0.25s linear; }
    .adtime { font-size: 0.7em; color: #9a9a9a; }
  `;

  function el(tag, cls, ...kids) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }

  function button(cls, text, onClick) {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  class Overlay {
    // handlers: { onAnswer(card, ok, ms), onRate(card, value), onNext(), onBack() }
    // options.layout: "player" (on top of the YouTube player) or "page" (fills its box, for practice mode)
    constructor(player, handlers, options = {}) {
      this.handlers = handlers;
      // "ad" while the ad runs, "after" once it has finished, "practice" in the manual mode
      this.mode = options.layout === "page" ? "practice" : "ad";
      this.lockRemaining = 0; // exam mode: correct answers still needed before the video continues
      this.timers = [];

      this.host = document.createElement("div");
      this.host.id = "lta-overlay";
      // Covers the left part of the player and leaves the bottom free,
      // so YouTube's controls and the "Skip" button stay visible and clickable.
      const style = options.layout === "page"
        ? { position: "relative", display: "block", width: "100%", "container-type": "inline-size" }
        : {
            position: "absolute", top: "0", left: "0", bottom: "56px",
            width: "clamp(300px, 58%, 760px)", "max-width": "100%",
            "z-index": "1000", "container-type": "inline-size",
          };
      for (const [k, v] of Object.entries(style)) this.host.style.setProperty(k, v, "important");

      // A click on the player normally pauses the video, and keys like space or arrows control it.
      // Inside the card window those events must stay with the card.
      for (const type of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress"]) {
        this.host.addEventListener(type, (e) => e.stopPropagation());
      }

      const shadow = this.host.attachShadow({ mode: "open" });
      const styleEl = document.createElement("style");
      styleEl.textContent = CSS;
      this.panel = el("div", options.layout === "page" ? "panel page" : "panel");
      shadow.append(styleEl, this.panel);
      player.append(this.host);
    }

    destroy() {
      this.clearTimers();
      this.host.remove();
    }

    clearTimers() {
      this.timers.forEach(clearInterval);
      this.timers = [];
    }

    setMode(mode) {
      this.mode = mode;
      if (this.footer) this.renderFooter();
    }

    // Exam mode: how many correct answers are still missing. 0 = the video may continue.
    setLock(remaining) {
      this.lockRemaining = Math.max(0, remaining);
      if (this.footer) this.renderFooter();
    }

    setAdProgress(fraction, secondsLeft) {
      if (this.mode !== "ad" || !this.barFill) return;
      this.barFill.style.width = Math.min(100, Math.max(0, fraction * 100)) + "%";
      this.adTime.textContent = `Ad muted · ${secondsLeft} s left`;
    }

    showCard(card, info = {}) {
      this.clearTimers();
      this.card = card;
      this.info = info;
      this.answered = false;
      this.shownAt = Date.now();
      this.panel.replaceChildren();

      const streak = info.streak ? `🔥 ${info.streak} day streak` : "";
      this.panel.append(
        el("div", "top",
          el("span", null, `${SUBJECTS[card.subject] || card.subject} · Ch. ${card.chapter} ${card.chapter_title || ""}`),
          el("span", null, streak)),
        el("div", "hook", card.type === "cloze" ? card.hook.replace("____", "______") : card.hook)
      );

      this.body = el("div");
      this.reveal = el("div", "reveal");
      this.reveal.hidden = true;
      this.footer = el("div", "footer");
      this.panel.append(this.body, this.reveal, this.footer);

      const render = {
        hook_reveal: () => this.renderSelfCheck(null),
        variables: () => this.renderSelfCheck("Name the IV and the DV in your head, then reveal."),
        find_error: () => this.renderFindError(),
        cloze: () => this.renderCloze(),
        estimate: () => this.renderEstimate(),
      }[card.type];
      render();
      this.renderFooter();
    }

    // Records the answer once and shows the resolution.
    answer(ok) {
      if (this.answered) return;
      this.answered = true;
      this.handlers.onAnswer(this.card, ok, Date.now() - this.shownAt);
    }

    showReveal(ok) {
      const card = this.card;
      this.reveal.hidden = false;
      this.reveal.replaceChildren();
      if (ok !== null) {
        this.reveal.append(el("div", "verdict " + (ok ? "ok" : "bad"), ok ? "Correct" : "Not quite"));
      }
      if (card.type === "variables") {
        this.reveal.append(
          el("div", null, el("span", "label", "IV: "), card.iv),
          el("div", null, el("span", "label", "DV: "), card.dv)
        );
      }
      this.reveal.append(el("div", null, card.answer));
      if (card.source) this.reveal.append(el("div", "source", "Source: " + card.source));

      const rate = el("div", "rate", "Card quality:");
      for (const [emoji, value] of [["👍", "up"], ["😐", "neutral"], ["👎", "down"]]) {
        const b = button(null, emoji, () => {
          rate.querySelectorAll("button:not(.more)").forEach((x) => x.classList.remove("chosen"));
          b.classList.add("chosen");
          this.handlers.onRate(card, value);
        });
        b.title = "Rate this card: " + value;
        rate.append(b);
      }
      if (typeof card.notes_link === "string" && /^https:\/\//.test(card.notes_link)) {
        rate.append(button("more", "more", () => window.open(card.notes_link, "_blank", "noopener")));
      }
      this.reveal.append(rate);
    }

    // Hook and reveal / spot the variables: think first, then reveal, then say honestly if you knew it.
    renderSelfCheck(hint) {
      if (hint) this.body.append(el("div", "hint", hint));
      const row = el("div", "buttons");
      const show = button("btn primary wide", "Show answer (3)", () => {
        row.replaceChildren();
        const yes = button("btn primary", "I knew it", () => done(true));
        const no = button("btn", "I didn't", () => done(false));
        const done = (ok) => {
          yes.disabled = no.disabled = true;
          (ok ? yes : no).classList.add(ok ? "ok" : "bad");
          this.answer(ok);
        };
        row.append(yes, no);
        this.showReveal(null);
      });
      show.disabled = true;
      let n = 3;
      const t = setInterval(() => {
        n--;
        if (n > 0) {
          show.textContent = `Show answer (${n})`;
        } else {
          clearInterval(t);
          show.textContent = "Show answer";
          show.disabled = false;
        }
      }, 1000);
      this.timers.push(t);
      row.append(show);
      this.body.append(row);
    }

    renderFindError() {
      const card = this.card;
      const code = el("div", "code");
      card.lines.forEach((line, i) => {
        const b = button(null, null, () => {
          const ok = i + 1 === card.error_line;
          code.querySelectorAll("button").forEach((x, j) => {
            x.disabled = true;
            if (j + 1 === card.error_line) x.classList.add("ok");
          });
          if (!ok) b.classList.add("bad");
          this.answer(ok);
          this.showReveal(ok);
        });
        b.append(el("span", "num", String(i + 1)), line);
        code.append(b);
      });
      this.body.append(code);
    }

    renderCloze() {
      const card = this.card;
      const correct = card.options[0];
      const order = Math.random() < 0.5 ? [0, 1] : [1, 0];
      const row = el("div", "buttons");
      const buttons = order.map((i) => {
        const b = button("btn", card.options[i], () => {
          const ok = i === 0;
          buttons.forEach((x) => (x.disabled = true));
          b.classList.add(ok ? "ok" : "bad");
          if (!ok) buttons.find((x) => x.textContent === correct).classList.add("ok");
          this.answer(ok);
          this.showReveal(ok);
        });
        return b;
      });
      row.append(...buttons);
      this.body.append(row);
    }

    renderEstimate() {
      const e = this.card.estimate;
      const unit = e.unit ? " " + e.unit : "";
      const value = el("div", "slider-value", e.min + unit);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = e.min;
      slider.max = e.max;
      slider.step = e.step || 1;
      slider.value = e.min; // never start on or near the answer
      slider.addEventListener("input", () => (value.textContent = slider.value + unit));
      const lock = button("btn primary wide", "Lock in", () => {
        slider.disabled = lock.disabled = true;
        const guess = Number(slider.value);
        const ok = Math.abs(guess - e.correct) <= e.tolerance;
        value.textContent = `You: ${guess}${unit} · Real: ${e.correct}${unit}`;
        this.answer(ok);
        this.showReveal(ok);
      });
      this.body.append(value, slider, el("div", "buttons", lock));
    }

    renderFooter() {
      this.footer.replaceChildren();
      this.barFill = null;
      if (this.mode === "ad") {
        this.barFill = el("div");
        this.adTime = el("div", "adtime", "Ad muted");
        this.footer.append(el("div", "bar", this.barFill), this.adTime);
      } else if (this.mode === "practice") {
        const pos = this.info && this.info.position;
        if (pos) this.footer.append(el("div", "adtime", `Card ${pos.index} of ${pos.total}`));
        const last = pos && pos.index >= pos.total;
        this.footer.append(el("div", "buttons",
          button("btn wide", last ? "Finish" : "Next card", () => this.handlers.onNext())
        ));
      } else {
        // Same size, same row, both clickable right away. No tricks.
        // Only in exam mode, which the user switched on themselves, "Back to video" waits for the goal.
        const locked = this.lockRemaining > 0;
        const back = button("btn", locked ? `Back to video · ${this.lockRemaining} more correct` : "Back to video",
          () => this.handlers.onBack());
        back.disabled = locked;
        if (locked) {
          this.footer.append(el("div", "adtime", "Exam mode is on. You can switch it off in the extension's settings."));
        }
        this.footer.append(el("div", "buttons",
          button("btn primary", locked ? "Next card" : "Keep learning, one more card?", () => this.handlers.onNext()),
          back
        ));
      }
    }
  }

  LTA.Overlay = Overlay;
})(typeof self !== "undefined" ? self : globalThis);
