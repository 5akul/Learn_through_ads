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

  // Slider step: about 100 positions across the range, as a round number (…, 0.1, 1, 10, …),
  // and small enough that the real value can be picked exactly (e.g. -0.4 on a -2 to 0 slider).
  function sliderStep(e) {
    let step = Math.pow(10, Math.floor(Math.log10((e.max - e.min) / 100 || 1)));
    for (let i = 0; i < 6; i++) {
      const n = (e.correct - e.min) / step;
      if (Math.abs(n - Math.round(n)) < 1e-6) break;
      step /= 10;
    }
    return step;
  }

  const CSS = `
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .panel {
      height: 100%; overflow: hidden; padding: 1.1em 1.1em 1em;
      display: flex; flex-direction: column; align-items: center; gap: 0.8em;
      background: #0f0f0f; color: #f1f1f1; /* solid: the ad must not show through */
      /* --fs is set by fit(): the largest text size at which the whole card fits the player. */
      font: 400 var(--fs, 16px)/1.4 Roboto, Arial, sans-serif;
    }
    .content, .footer { width: 100%; max-width: 64em; }
    .panel.page { height: auto; min-height: 18em; border-radius: 14px; font-size: clamp(14px, 3.6cqw, 20px); }
    /* Hidden card: only a small button stays, the player is free again. */
    .panel.min { height: auto; padding: 0; background: none; font-size: 13px; }
    .panel.min .content, .panel.min .footer { display: none; }
    .pill {
      display: none; font: inherit; font-weight: 600; padding: 0.5em 0.9em; border: 0; border-radius: 2em;
      background: #0f0f0f; color: #f1f1f1; cursor: pointer; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
    }
    .panel.min .pill { display: block; }
    .hide { background: none; border: 0; padding: 0; font: inherit; color: inherit; text-decoration: underline; cursor: pointer; }
    .panel.esc-space:not(.min) { padding-top: 76px; }
    .skiphint { font-size: 0.8em; font-weight: 600; color: #ffcc00; }
    .frame { position: absolute; border: 3px solid #ffcc00; border-radius: 8px; pointer-events: none; }
    /* The card itself scrolls if it is ever too long; the footer below always stays in view. */
    .content { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: thin; display: flex; flex-direction: column; }
    /* The card sits in the middle of the free height. */
    .inner { margin: auto 0; display: flex; flex-direction: column; gap: 0.8em; }
    .panel.page .inner { margin: 0; }
    .reserved { visibility: hidden; }
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
    .answer-label { font-size: 0.7em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #ffcc00; }
    .strong { font-size: 1.05em; font-weight: 600; }
    .ask { margin-top: 0.5em; font-size: 0.85em; color: #9a9a9a; }
    .verdict.ok { color: #3ea66b; }
    .verdict.bad { color: #e06c68; }
    .label { color: #9a9a9a; }
    .source { font-size: 0.8em; color: #9a9a9a; }
    .rate { display: flex; align-items: center; gap: 0.4em; flex-wrap: wrap; font-size: 0.8em; color: #9a9a9a; margin-top: 0.3em; }
    .rate button { font-size: 1.1em; padding: 0.15em 0.5em; border: 0; border-radius: 0.4em; background: #3a3a3a; cursor: pointer; }
    .rate button.chosen { outline: 2px solid #f1f1f1; }
    .rate .more { margin-left: auto; background: none; color: #9a9a9a; text-decoration: underline; font-size: 1em; }
    .footer { flex: none; display: flex; flex-direction: column; gap: 0.35em; }
    .bar { height: 4px; background: #2e2e2e; border-radius: 2px; overflow: hidden; }
    .bar div { height: 100%; width: 0; background: #ffcc00; transition: width 0.25s linear; }
    .adtime { font-size: 0.7em; color: #9a9a9a; }
  `;

  // Right after switching to fullscreen, Chrome shows "Press Esc to exit full screen" at the top
  // for a few seconds. Extensions cannot hide it, so the card keeps that strip free for a moment.
  const ESC_HINT_MS = 4500;
  let fullscreenSince = 0;
  const openOverlays = new Set();
  document.addEventListener("fullscreenchange", () => {
    fullscreenSince = document.fullscreenElement ? Date.now() : 0;
    for (const overlay of openOverlays) overlay.updateEscSpace();
  });

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

      this.layout = options.layout === "page" ? "page" : "player";
      this.minimized = false;
      this.hole = null; // the spot left open for YouTube's Skip button
      this.holeKey = "";

      this.host = document.createElement("div");
      this.host.id = "lta-overlay";
      this.applyLayout();

      // A click on the player normally pauses the video, and keys like space or arrows control it.
      // Inside the card window those events must stay with the card.
      for (const type of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress"]) {
        this.host.addEventListener(type, (e) => e.stopPropagation());
      }

      const shadow = this.host.attachShadow({ mode: "open" });
      const styleEl = document.createElement("style");
      styleEl.textContent = CSS;
      this.panel = el("div", options.layout === "page" ? "panel page" : "panel");
      this.pill = button("pill", "Show card", () => this.setMinimized(false));
      this.frame = el("div", "frame");
      this.frame.hidden = true;
      shadow.append(styleEl, this.panel, this.frame);
      player.append(this.host);

      openOverlays.add(this);
      this.updateEscSpace();

      if (this.layout === "player" && typeof ResizeObserver === "function") {
        // The player changed size (fullscreen, theatre mode): the Skip button moved too, so measure it first.
        this.resizeObserver = new ResizeObserver(() => {
          this.updateHole();
          this.fit();
        });
        this.resizeObserver.observe(this.host);
      }
    }

    // Moves the card down while Chrome's "Press Esc" notice is showing, then back up.
    updateEscSpace() {
      clearTimeout(this.escTimer);
      if (this.layout !== "player") return;
      const left = fullscreenSince ? fullscreenSince + ESC_HINT_MS - Date.now() : 0;
      const on = left > 0;
      const changed = on !== this.panel.classList.contains("esc-space");
      this.panel.classList.toggle("esc-space", on);
      if (on) this.escTimer = setTimeout(() => this.updateEscSpace(), left + 20);
      if (changed) {
        this.updateHole();
        this.fit();
      }
    }

    // Chooses the largest text size at which the complete card (question, answer and buttons)
    // fits into the player. So there is nothing to scroll and no empty area left over.
    // Only if a card is too long even at the smallest size does the card scroll.
    fit() {
      if (this.layout !== "player" || this.minimized || !this.inner) return;
      const box = this.host.getBoundingClientRect();
      if (!box.height || !box.width) return;
      const fits = (size) => {
        this.panel.style.setProperty("--fs", size + "px");
        return this.inner.offsetHeight <= this.content.clientHeight;
      };
      const search = (low, high) => {
        if (fits(high)) return;
        for (let i = 0; i < 8; i++) {
          const mid = (low + high) / 2;
          if (fits(mid)) low = mid;
          else high = mid;
        }
        this.panel.style.setProperty("--fs", Math.floor(low * 10) / 10 + "px");
      };
      const largest = Math.max(9, Math.min(box.height * 0.075, box.width * 0.045, 54));
      search(9, largest);
      // Making room for the Skip opening can wrap a line. If so, go one step smaller.
      this.avoidHole();
      if (this.inner.offsetHeight > this.content.clientHeight) {
        search(9, parseFloat(this.panel.style.getPropertyValue("--fs")));
        this.avoidHole();
      }
    }

    // Keeps the card's own rows out of the opening left for YouTube's Skip button.
    avoidHole() {
      for (const part of [this.content, this.footer]) {
        if (!part) continue;
        let pad = 0;
        if (this.hole && !this.minimized && this.layout === "player") {
          const host = this.host.getBoundingClientRect();
          const box = part.getBoundingClientRect();
          const gap = 10;
          const left = host.left + this.hole.x - gap;
          const top = host.top + this.hole.y - gap;
          const bottom = host.top + this.hole.y + this.hole.h + gap;
          if (box.bottom > top && box.top < bottom && box.right > left) pad = box.right - left;
        }
        part.style.paddingRight = pad ? pad + "px" : "";
      }
    }

    // After a change inside the same card: keep the size steady, only shrink if something no longer fits.
    ensureFits() {
      if (this.layout !== "player" || this.minimized || !this.inner) return;
      this.avoidHole();
      if (this.inner.offsetHeight > this.content.clientHeight) this.fit();
    }

    // On YouTube the card covers the whole player, so nothing of the ad shows next to it.
    // "Hide card" shrinks it to a small button and gives the player back.
    applyLayout() {
      let style;
      if (this.layout === "page") {
        style = { position: "relative", display: "block", width: "100%", "container-type": "inline-size" };
      } else if (this.minimized) {
        style = {
          position: "absolute", top: "10px", left: "10px", right: "auto", bottom: "auto",
          "z-index": "1000", "container-type": "normal", "clip-path": "none",
        };
      } else {
        style = {
          position: "absolute", top: "0", left: "0", right: "0", bottom: "0",
          "z-index": "1000", "container-type": "size", "clip-path": this.holePath(),
        };
      }
      for (const [k, v] of Object.entries(style)) this.host.style.setProperty(k, v, "important");
    }

    setMinimized(on) {
      this.minimized = on;
      this.panel.classList.toggle("min", on);
      this.applyLayout();
      this.applyFrame();
      if (!on) {
        this.updateHole();
        this.fit();
      }
    }

    // YouTube's own Skip button stays the only way to skip. When it is there, the card leaves
    // an opening exactly over it, so the click goes to YouTube, and a hint points to it.
    setSkipButton(buttonEl) {
      this.skipEl = buttonEl || null;
      this.updateHole();
    }

    updateHole() {
      if (this.minimized) return; // measured again when the card is shown again
      let hole = null;
      if (this.skipEl && this.skipEl.isConnected && this.layout === "player") {
        const h = this.host.getBoundingClientRect();
        const b = this.skipEl.getBoundingClientRect();
        const margin = 6;
        if (b.width && b.height) {
          hole = {
            x: Math.round(b.left - h.left - margin), y: Math.round(b.top - h.top - margin),
            w: Math.round(b.width + 2 * margin), h: Math.round(b.height + 2 * margin),
          };
        }
      }
      const key = hole ? `${hole.x},${hole.y},${hole.w},${hole.h}` : "";
      if (key === this.holeKey) return;
      const appearedOrGone = !!hole !== !!this.hole;
      this.hole = hole;
      this.holeKey = key;
      this.applyLayout();
      this.applyFrame();
      if (!this.footer) return;
      if (appearedOrGone) this.renderFooter(); // show or hide the hint; text size stays steady
      else this.fit(); // the button moved, so the layout really changed
    }

    holePath() {
      const o = this.hole;
      if (!o) return "none";
      const x2 = o.x + o.w;
      const y2 = o.y + o.h;
      return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
        `${o.x}px ${o.y}px, ${x2}px ${o.y}px, ${x2}px ${y2}px, ${o.x}px ${y2}px, ${o.x}px ${o.y}px)`;
    }

    applyFrame() {
      const o = this.hole;
      this.frame.hidden = !o || this.minimized || this.layout !== "player";
      if (this.frame.hidden) return;
      const border = 3;
      this.frame.style.left = o.x - border + "px";
      this.frame.style.top = o.y - border + "px";
      this.frame.style.width = o.w + 2 * border + "px";
      this.frame.style.height = o.h + 2 * border + "px";
    }

    destroy() {
      openOverlays.delete(this);
      clearTimeout(this.escTimer);
      this.clearTimers();
      if (this.resizeObserver) this.resizeObserver.disconnect();
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
      this.lastProgress = { fraction, secondsLeft };
      if (this.mode !== "ad" || !this.barFill) return;
      this.barFill.style.width = Math.min(100, Math.max(0, fraction * 100)) + "%";
      this.adTime.textContent = `Ad muted · ${secondsLeft} s left`;
    }

    showCard(card, info = {}) {
      this.clearTimers();
      this.card = card;
      this.info = info;
      this.answered = false;
      this.revealed = false;
      this.shownAt = Date.now();
      this.inner = el("div", "inner");
      this.content = el("div", "content", this.inner);
      this.footer = el("div", "footer");
      this.panel.replaceChildren(this.pill, this.content, this.footer);

      const right = el("span", null, info.streak ? `🔥 ${info.streak} day streak` : "");
      if (this.layout === "player") {
        if (info.streak) right.append(" · ");
        right.append(button("hide", "Hide card", () => this.setMinimized(true)));
      }
      this.inner.append(
        el("div", "top",
          el("span", null, `${SUBJECTS[card.subject] || card.subject} · Ch. ${card.chapter} ${card.chapter_title || ""}`),
          right),
        el("div", "hook", card.type === "cloze" ? card.hook.replace("____", "______") : card.hook)
      );

      this.body = el("div");
      this.reveal = el("div", "reveal");
      this.inner.append(this.body, this.reveal);

      const render = {
        hook_reveal: () => this.renderSelfCheck(null),
        variables: () => this.renderSelfCheck("Name the IV and the DV in your head, then reveal."),
        find_error: () => this.renderFindError(),
        cloze: () => this.renderCloze(),
        estimate: () => this.renderEstimate(),
      }[card.type];
      render();

      // On YouTube the answer area is built right away but kept invisible. Its space is reserved,
      // so the text size is right from the start and nothing jumps when the answer appears.
      if (this.layout === "player") {
        const selfCheck = card.type === "hook_reveal" || card.type === "variables";
        this.buildReveal(selfCheck ? null : true);
        this.reveal.classList.add("reserved");
      } else {
        this.reveal.hidden = true;
      }
      this.renderFooter();
      this.fit();
    }

    // Records the answer once and shows the resolution.
    answer(ok) {
      if (this.answered) return;
      this.answered = true;
      this.handlers.onAnswer(this.card, ok, Date.now() - this.shownAt);
    }

    // ok is true/false when the card could check the answer itself,
    // and null when the user judges themselves after seeing the answer.
    showReveal(ok) {
      this.revealed = true;
      this.buildReveal(ok);
      this.reveal.hidden = false;
      this.reveal.classList.remove("reserved");
      this.renderFooter(); // "Next card" becomes available
    }

    buildReveal(ok) {
      const card = this.card;
      const selfCheck = ok === null;
      this.reveal.replaceChildren();
      if (selfCheck) {
        this.reveal.append(el("div", "answer-label", "Answer"));
      } else {
        this.reveal.append(el("div", "verdict " + (ok ? "ok" : "bad"), ok ? "Correct" : "Not quite"));
      }
      if (card.type === "variables") {
        this.reveal.append(
          el("div", "strong", el("span", "label", "IV: "), card.iv),
          el("div", "strong", el("span", "label", "DV: "), card.dv)
        );
      }
      this.reveal.append(el("div", selfCheck && card.type !== "variables" ? "answer strong" : "answer", card.answer));
      if (card.source) this.reveal.append(el("div", "source", "Source: " + card.source));

      if (selfCheck) {
        // Both buttons look the same on purpose: no nudge towards "I knew it".
        const yes = button("btn", "I knew it", () => done(true));
        const no = button("btn", "I didn't", () => done(false));
        const done = (knewIt) => {
          yes.disabled = no.disabled = true;
          (knewIt ? yes : no).classList.add(knewIt ? "ok" : "bad");
          this.answer(knewIt);
        };
        this.reveal.append(el("div", "ask", "Did you know it?"), el("div", "buttons", yes, no));
      }

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
      const show = button("btn primary wide", "Show answer (3)", () => {
        this.body.replaceChildren();
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
      this.body.append(el("div", "buttons", show));
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
      slider.step = sliderStep(e);
      slider.value = e.min; // never start on or near the answer
      slider.addEventListener("input", () => (value.textContent = slider.value + unit));
      const lock = button("btn primary wide", "Lock in", () => {
        slider.disabled = lock.disabled = true;
        const guess = Number(slider.value);
        const ok = Math.abs(guess - e.correct) <= e.tolerance + 1e-9; // 1e-9: rounding in decimals
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
        // Done with this card while the ad is still running? Go on right away.
        // Both rows always take their space and only become visible when they apply.
        const next = el("div", "buttons", button("btn primary wide", "Next card", () => this.handlers.onNext()));
        if (!this.revealed) next.classList.add("reserved");
        const hint = el("div", "skiphint", "You can skip this ad now: YouTube's Skip button is in the yellow frame.");
        if (!this.hole) hint.classList.add("reserved");
        this.footer.append(next, hint);
        this.barFill = el("div");
        this.adTime = el("div", "adtime", "Ad muted");
        this.footer.append(el("div", "bar", this.barFill), this.adTime);
        if (this.lastProgress) this.setAdProgress(this.lastProgress.fraction, this.lastProgress.secondsLeft);
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
      this.ensureFits();
    }
  }

  LTA.Overlay = Overlay;
})(typeof self !== "undefined" ? self : globalThis);
