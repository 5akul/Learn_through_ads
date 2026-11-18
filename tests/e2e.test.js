// Loads the real extension into Chromium and plays through ad breaks on a fake YouTube page.
// Run: node tests/e2e.test.js   (needs Playwright with Chromium, and ffmpeg for the test video)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EXT = path.resolve(__dirname, "../extension");
const PAGE = fs.readFileSync(path.join(__dirname, "fake-youtube.html"));
const shotsDir = process.env.SHOTS_DIR || null;

function makeVideo() {
  const file = path.join(os.tmpdir(), "lta-test-video.webm");
  if (!fs.existsSync(file)) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=size=854x480:rate=15:duration=40",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=40",
      "-c:v", "libvpx", "-b:v", "300k", "-c:a", "libvorbis", "-shortest", file]);
  }
  return fs.readFileSync(file);
}

(async () => {
  const video = makeVideo();
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "lta-profile-"));
  const context = await chromium.launchPersistentContext(userDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1000, height: 600 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--autoplay-policy=no-user-gesture-required"],
  });
  await context.route("https://www.youtube.com/**", (route) => {
    const url = route.request().url();
    if (url.endsWith("/test-video.webm")) return route.fulfill({ body: video, contentType: "video/webm" });
    return route.fulfill({ body: PAGE, contentType: "text/html" });
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("https://www.youtube.com/watch?v=test");

  const vid = () => page.evaluate(() => {
    const v = document.querySelector("video");
    return { muted: v.muted, paused: v.paused };
  });
  const setAd = (on) => page.evaluate((on) => document.querySelector("#movie_player").classList.toggle("ad-showing", on), on);
  const overlay = page.locator("#lta-overlay");
  const steps = [];
  const step = async (name, fn) => { await fn(); steps.push(name); console.log("ok  ", name); };

  await page.waitForFunction(() => !document.querySelector("video").paused);
  assert.equal((await vid()).muted, false);

  await step("ad starts: card appears and the ad is muted", async () => {
    await setAd(true);
    await overlay.waitFor();
    assert.equal((await vid()).muted, true);
    assert.equal((await vid()).paused, false, "the ad must keep playing");
  });

  await step("progress bar runs during the ad", async () => {
    await page.waitForTimeout(1200);
    const width = await page.evaluate(() =>
      document.querySelector("#lta-overlay").shadowRoot.querySelector(".bar div").style.width);
    assert.ok(parseFloat(width) > 0, "bar width " + width);
    assert.match(await overlay.locator(".adtime").textContent(), /Ad muted · \d+ s left/);
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "1-during-ad.png") });
  });

  const showSkip = (on) => page.evaluate((on) =>
    (document.querySelector(".ytp-skip-ad-button").style.display = on ? "block" : "none"), on);
  const hostStyle = (prop) => page.evaluate((prop) =>
    getComputedStyle(document.querySelector("#lta-overlay"))[prop], prop);

  await step("the card covers the whole player and nothing shows through", async () => {
    const o = await overlay.boundingBox();
    const p = await page.locator("#movie_player").boundingBox();
    for (const k of ["x", "y", "width", "height"]) assert.ok(Math.abs(o[k] - p[k]) <= 1, `${k}: card ${o[k]}, player ${p[k]}`);
    const background = await page.evaluate(() =>
      getComputedStyle(document.querySelector("#lta-overlay").shadowRoot.querySelector(".panel")).backgroundColor);
    assert.equal(background, "rgb(15, 15, 15)", "background must be solid");
    assert.equal(await hostStyle("clipPath"), "none", "no opening while the ad cannot be skipped");
    assert.equal(await overlay.locator(".skiphint:visible").count(), 0);
  });

  await step("ad can be skipped: a hint appears and YouTube's Skip button is reachable", async () => {
    await showSkip(true);
    await overlay.locator(".skiphint").waitFor();
    assert.match(await overlay.locator(".skiphint").textContent(), /You can skip this ad now/);
    const skip = await page.locator(".ytp-skip-ad-button").boundingBox();
    const centre = [skip.x + skip.width / 2, skip.y + skip.height / 2];
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y).className, centre);
    assert.equal(hit, "ytp-skip-ad-button", "the opening must sit exactly over the Skip button");
    await page.mouse.click(...centre); // a real click, by the user, on YouTube's own button
    assert.equal(await page.evaluate(() => window.skipClicks), 1);
    assert.equal((await vid()).paused, false);
    // just outside the opening the card is still there
    const outside = await page.evaluate(([x, y]) => document.elementFromPoint(x, y).id, [skip.x - 30, skip.y - 30]);
    assert.equal(outside, "lta-overlay");
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "1b-skippable.png") });
    await showSkip(false);
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#lta-overlay")).clipPath === "none");
    assert.equal(await overlay.locator(".skiphint:visible").count(), 0);
  });

  await step("'Hide card' gives the player back, 'Show card' brings the card back", async () => {
    const p = await page.locator("#movie_player").boundingBox();
    await overlay.locator("text=Hide card").click();
    let o = await overlay.boundingBox();
    assert.ok(o.width < 200 && o.height < 60, `hidden card is ${o.width}x${o.height}`);
    assert.equal((await vid()).muted, true, "the ad stays muted");
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "1c-hidden.png") });
    await overlay.locator("text=Show card").click();
    o = await overlay.boundingBox();
    assert.ok(Math.abs(o.width - p.width) <= 1 && Math.abs(o.height - p.height) <= 1);
    assert.equal(await overlay.locator(".hook").isVisible(), true);
  });

  await step("clicking inside the card does not pause the video", async () => {
    await overlay.locator(".hook").click();
    assert.equal((await vid()).paused, false);
  });

  await step("answering a card shows the answer and the rating buttons", async () => {
    const o = overlay;
    if (await o.locator("text=Show answer").count()) {
      await o.locator("button:has-text('Show answer'):not([disabled])").click({ timeout: 5000 });
      await o.locator("text=I knew it").click();
    } else if (await o.locator(".code").count()) {
      await o.locator(".code button").first().click();
    } else if (await o.locator("text=Lock in").count()) {
      await o.locator("input[type=range]").fill("20");
      await o.locator("text=Lock in").click();
    } else {
      await o.locator(".content .buttons .btn").first().click();
    }
    await o.locator(".reveal").waitFor();
    await o.locator(".rate button", { hasText: "👍" }).click();
  });

  await step("ad ends: sound comes back, video waits, both buttons appear", async () => {
    await setAd(false);
    await overlay.locator("text=Back to video").waitFor();
    const v = await vid();
    assert.equal(v.muted, false, "sound must be restored");
    assert.equal(v.paused, true, "video must wait for the choice");
    const [a, b] = await Promise.all([
      overlay.locator("text=Keep learning, one more card?").boundingBox(),
      overlay.locator("text=Back to video").boundingBox(),
    ]);
    assert.ok(Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1, "buttons must be the same size");
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "2-after-ad.png") });
  });

  await step("YouTube's own autoplay right after the ad is held back", async () => {
    await page.evaluate(() => document.querySelector("video").play());
    await page.waitForTimeout(300);
    assert.equal((await vid()).paused, true);
  });

  await step("'Keep learning' shows a different card, video still waits", async () => {
    const before = await overlay.locator(".hook").textContent();
    await overlay.locator("text=Keep learning, one more card?").click();
    await page.waitForFunction((b) =>
      document.querySelector("#lta-overlay").shadowRoot.querySelector(".hook").textContent !== b, before);
    assert.equal((await vid()).paused, true);
  });

  await step("'Back to video' closes the card and plays the video", async () => {
    await overlay.locator("text=Back to video").click();
    await overlay.waitFor({ state: "detached" });
    await page.waitForFunction(() => !document.querySelector("video").paused);
  });

  await step("pressing play in YouTube later also closes the card", async () => {
    await setAd(true);
    await overlay.waitFor();
    await setAd(false);
    await overlay.locator("text=Back to video").waitFor();
    await page.waitForTimeout(3300); // after the autoplay guard
    await page.evaluate(() => document.querySelector("video").play());
    await overlay.waitFor({ state: "detached" });
  });

  await step("a user who had muted YouTube stays muted after the ad", async () => {
    await page.evaluate(() => (document.querySelector("video").muted = true));
    await setAd(true);
    await overlay.waitFor();
    await setAd(false);
    await overlay.locator("text=Back to video").waitFor();
    assert.equal((await vid()).muted, true);
    await overlay.locator("text=Back to video").click();
    await page.evaluate(() => (document.querySelector("video").muted = false));
  });

  await step("history is saved locally: shows, answer, rating", async () => {
    const data = await worker.evaluate(() => chrome.storage.local.get(["events", "ratings"]));
    const shows = data.events.filter((e) => e.type === "show");
    const answers = data.events.filter((e) => e.type === "answer");
    assert.equal(shows.length, 4);
    assert.equal(answers.length, 1);
    assert.equal(typeof answers[0].ok, "boolean");
    assert.ok(answers[0].ms > 0);
    assert.equal(Object.values(data.ratings)[0].value, "up");
    assert.equal(new Set(shows.map((s) => s.id)).size, 4, "no card twice on the same day");
  });

  // ---- A card with two answer buttons (type "cloze"), picked on purpose
  const allCards = fs.readdirSync(path.join(EXT, "cards"))
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(EXT, "cards", f), "utf8")).cards);

  // Marks every other card as "already shown today", so the next card must be a two-answer card.
  const onlyTwoAnswerCardsLeft = async () => {
    const seen = allCards.filter((c) => c.type !== "cloze").map((c) => ({ type: "show", id: c.id, t: Date.now() }));
    await worker.evaluate((events) => chrome.storage.local.set({ events, ratings: {} }), seen);
  };
  const openTwoAnswerCard = async () => {
    await onlyTwoAnswerCardsLeft();
    await setAd(true);
    await overlay.waitFor();
    const hook = await overlay.locator(".hook").textContent();
    const card = allCards.find((c) => c.type === "cloze" && c.hook.replace("____", "______") === hook);
    assert.ok(card, "expected a two-answer card, got: " + hook);
    const texts = await overlay.locator(".content .buttons .btn").allTextContents();
    assert.deepEqual([...texts].sort(), [...card.options].sort(), "exactly the two options as buttons");
    return card;
  };
  // Escapes characters like ( ) that have a special meaning in a search pattern.
  const exact = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  const optionButton = (text) => overlay.locator(".content .buttons .btn", { hasText: exact(text) });
  const lastAnswer = async () => {
    const { events } = await worker.evaluate(() => chrome.storage.local.get("events"));
    return events.filter((e) => e.type === "answer").pop();
  };
  const closeCard = async () => {
    await setAd(false);
    await overlay.locator("text=Back to video").click();
    await overlay.waitFor({ state: "detached" });
  };

  await step("two-answer card: the right answer turns green and counts as correct", async () => {
    const card = await openTwoAnswerCard();
    const right = optionButton(card.options[0]);
    await right.click();
    assert.equal(await overlay.locator(".verdict").textContent(), "Correct");
    assert.match(await right.getAttribute("class"), /\bok\b/);
    assert.equal(await overlay.locator(".content .buttons .btn:disabled").count(), 2, "no second try");
    assert.equal(await overlay.locator(".reveal").textContent().then((t) => t.includes(card.answer)), true);
    const answer = await lastAnswer();
    assert.equal(answer.id, card.id);
    assert.equal(answer.ok, true);
    await closeCard();
  });

  await step("two-answer card: the wrong answer turns red, the right one is shown, counts as wrong", async () => {
    const card = await openTwoAnswerCard();
    const wrong = optionButton(card.options[1]);
    await wrong.click();
    assert.equal(await overlay.locator(".verdict").textContent(), "Not quite");
    assert.match(await wrong.getAttribute("class"), /\bbad\b/);
    assert.match(await optionButton(card.options[0]).getAttribute("class"), /\bok\b/);
    const answer = await lastAnswer();
    assert.equal(answer.id, card.id);
    assert.equal(answer.ok, false);
    await closeCard();
  });

  // ---- Exam mode, settings window, manual mode
  const reset = (settings = {}) =>
    worker.evaluate((settings) => chrome.storage.local.set({ events: [], ratings: {}, settings }), settings);
  const getSettings = async () => (await worker.evaluate(() => chrome.storage.local.get("settings"))).settings;
  const extensionUrl = (file) => worker.url().replace("background.js", file);

  // Answers whatever card is on screen correctly, by looking the card up in the card files.
  const answerCorrectly = async (scope) => {
    const hook = await scope.locator(".hook").textContent();
    const card = allCards.find((c) => (c.type === "cloze" ? c.hook.replace("____", "______") : c.hook) === hook);
    assert.ok(card, "card on screen not found in the card files: " + hook);
    if (card.type === "cloze") {
      await scope.locator(".content .buttons .btn", { hasText: exact(card.options[0]) }).click();
    } else if (card.type === "find_error") {
      await scope.locator(".code button").nth(card.error_line - 1).click();
    } else if (card.type === "estimate") {
      await scope.locator("input[type=range]").fill(String(card.estimate.correct));
      await scope.locator("text=Lock in").click();
    } else {
      await scope.locator("button:has-text('Show answer'):not([disabled])").click({ timeout: 6000 });
      await scope.locator("text=I knew it").click();
    }
    return card;
  };

  await step("exam mode: the video waits until enough cards are correct", async () => {
    await reset({ minCorrect: 2 });
    await setAd(true);
    await overlay.waitFor();
    await setAd(false);
    const back = overlay.locator(".footer .btn", { hasText: "Back to video" });
    await back.waitFor();
    assert.equal(await back.textContent(), "Back to video · 2 more correct");
    assert.equal(await back.isDisabled(), true);
    await page.waitForTimeout(3300); // after the autoplay guard: play must still be held back
    await page.evaluate(() => document.querySelector("video").play());
    await page.waitForTimeout(300);
    assert.equal((await vid()).paused, true, "video must stay paused in exam mode");
    assert.equal(await overlay.count(), 1, "card must stay open in exam mode");

    await answerCorrectly(overlay);
    assert.equal(await back.textContent(), "Back to video · 1 more correct");
    await overlay.locator("text=Next card").click();
    await page.waitForTimeout(300);
    await answerCorrectly(overlay);
    assert.equal(await back.textContent(), "Back to video");
    assert.equal(await back.isDisabled(), false);
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "3-exam-mode-done.png") });
    await back.click();
    await overlay.waitFor({ state: "detached" });
    await page.waitForFunction(() => !document.querySelector("video").paused);
  });

  await step("exam mode can be switched off at any time, even while it holds the video", async () => {
    await reset({ minCorrect: 3 });
    await setAd(true);
    await overlay.waitFor();
    await setAd(false);
    const back = overlay.locator(".footer .btn", { hasText: "Back to video" });
    await back.waitFor();
    assert.equal(await back.isDisabled(), true);
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "4-exam-mode-locked.png") });
    await worker.evaluate(() => chrome.storage.local.set({ settings: { minCorrect: 0 } }));
    await page.waitForFunction(() => {
      const buttons = document.querySelector("#lta-overlay").shadowRoot.querySelectorAll(".footer .btn");
      return [...buttons].every((b) => !b.disabled);
    });
    await back.click();
    await overlay.waitFor({ state: "detached" });
  });

  await step("settings window: chapter and exam mode are saved", async () => {
    await reset({});
    const popup = await context.newPage();
    popup.on("pageerror", (e) => errors.push("popup: " + e.message));
    await popup.setViewportSize({ width: 320, height: 520 });
    await popup.goto(extensionUrl("popup.html"));
    await popup.locator("select").first().waitFor();
    const subjects = new Set(allCards.map((c) => c.subject));
    assert.equal(await popup.locator("select").count(), subjects.size, "one chapter menu per subject with cards");
    const psych = allCards.find((c) => c.subject === "psychology");
    await popup.locator("select[data-subject=psychology]").selectOption(String(psych.chapter));
    await popup.locator("#examCount").fill("4");
    await popup.locator("#examOn").check();
    await popup.waitForTimeout(200);
    let s = await getSettings();
    assert.equal(s.currentChapter.psychology, psych.chapter);
    assert.equal(s.minCorrect, 4);
    if (shotsDir) await popup.screenshot({ path: path.join(shotsDir, "5-settings.png") });
    await popup.locator("#examOn").uncheck();
    await popup.locator("select[data-subject=psychology]").selectOption("");
    await popup.waitForTimeout(200);
    s = await getSettings();
    assert.equal(s.minCorrect, 0);
    assert.equal(s.examCount, 4, "the number is remembered for next time");
    assert.equal("psychology" in s.currentChapter, false);
    await popup.close();
  });

  await step("manual mode: a round of cards without YouTube, no card twice, with a result", async () => {
    await reset({});
    const practice = await context.newPage();
    practice.on("pageerror", (e) => errors.push("practice: " + e.message));
    await practice.goto(extensionUrl("practice.html"));
    const box = practice.locator("#lta-overlay");
    await box.waitFor();
    const total = Math.min(10, allCards.length);
    const seen = new Set();
    for (let i = 1; i <= total; i++) {
      await practice.waitForFunction((n) =>
        document.querySelector("#lta-overlay").shadowRoot.querySelector(".adtime").textContent.startsWith(`Card ${n} of`), i);
      assert.equal(await box.locator(".adtime").textContent(), `Card ${i} of ${total}`);
      if (i === 2 && shotsDir) await practice.screenshot({ path: path.join(shotsDir, "6-practice.png") });
      if (i === 1) {
        seen.add(await box.locator(".hook").textContent()); // skip the first card without answering
      } else {
        seen.add((await answerCorrectly(box)).hook);
      }
      await box.locator(".footer .btn").click();
    }
    assert.equal(seen.size, total, "no card twice in one round");
    await practice.locator(".summary").waitFor();
    assert.equal(await practice.locator(".summary .big").textContent(), `${total - 1} of ${total}`);
    assert.match(await practice.locator(".summary p").textContent(), /1 skipped/);
    if (shotsDir) await practice.screenshot({ path: path.join(shotsDir, "7-practice-result.png") });
    const { events } = await worker.evaluate(() => chrome.storage.local.get("events"));
    assert.equal(events.filter((e) => e.type === "answer").length, total - 1, "answers count for streak and repetition");
    await practice.close();
  });

  // ---- Feedback from the first real test on YouTube
  const onlyTypesLeft = async (types) => {
    const seen = allCards.filter((c) => !types.includes(c.type)).map((c) => ({ type: "show", id: c.id, t: Date.now() }));
    await worker.evaluate((events) => chrome.storage.local.set({ events, ratings: {}, settings: {} }), seen);
  };
  const footerButtons = () => overlay.locator(".footer .btn:visible").allTextContents();

  await step("long ad: after answering, 'Next card' brings a new card while the ad keeps running", async () => {
    await reset({});
    await setAd(true);
    await overlay.waitFor();
    assert.deepEqual(await footerButtons(), [], "no 'Next card' before the card is answered");
    await page.waitForFunction(() =>
      parseFloat(document.querySelector("#lta-overlay").shadowRoot.querySelector(".bar div").style.width) > 0);
    const first = await answerCorrectly(overlay);
    assert.deepEqual(await footerButtons(), ["Next card"]);
    const width = await page.evaluate(() =>
      document.querySelector("#lta-overlay").shadowRoot.querySelector(".bar div").style.width);
    assert.ok(parseFloat(width) > 0, "progress bar must not jump back to zero");
    await overlay.locator(".footer .btn").click();
    await page.waitForFunction((hook) =>
      document.querySelector("#lta-overlay").shadowRoot.querySelector(".hook").textContent !== hook,
      first.type === "cloze" ? first.hook.replace("____", "______") : first.hook);
    assert.deepEqual(await footerButtons(), [], "the new card is not answered yet");
    const v = await vid();
    assert.equal(v.paused, false, "the ad keeps running");
    assert.equal(v.muted, true, "the ad stays muted");
    assert.match(await overlay.locator(".adtime").textContent(), /^Ad muted/);
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "8-next-card-during-ad.png") });
    await closeCard();
  });

  await step("reveal card: the answer is labelled and comes before 'Did you know it?'", async () => {
    await onlyTypesLeft(["hook_reveal"]);
    await setAd(true);
    await overlay.waitFor();
    const hook = await overlay.locator(".hook").textContent();
    const card = allCards.find((c) => c.type === "hook_reveal" && c.hook === hook);
    assert.ok(card, "expected a reveal card, got: " + hook);
    await overlay.locator("button:has-text('Show answer'):not([disabled])").click({ timeout: 6000 });
    const order = await page.evaluate(() =>
      [...document.querySelector("#lta-overlay").shadowRoot.querySelector(".reveal").children].map((e) => e.className));
    assert.deepEqual(order.slice(0, 2), ["answer-label", "answer strong"]);
    assert.ok(order.indexOf("ask") > order.indexOf("answer strong"), "question comes after the answer");
    assert.equal(await overlay.locator(".answer-label").textContent(), "Answer");
    assert.equal(await overlay.locator(".answer").textContent(), card.answer);
    assert.equal(await overlay.locator("text=Show answer").count(), 0, "the reveal button is gone");
    for (const label of ["I knew it", "I didn't"]) {
      assert.doesNotMatch(await overlay.locator(".reveal .btn", { hasText: label }).getAttribute("class"), /primary/,
        "both self-check buttons look the same");
    }
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "9-reveal-card.png") });
    await overlay.locator("text=I didn't").click();
    assert.equal((await lastAnswer()).ok, false);
    await closeCard();
  });

  await step("two-answer card: the right answer is not always on the same side", async () => {
    const sides = new Set();
    for (let i = 0; i < 16 && sides.size < 2; i++) {
      const card = await openTwoAnswerCard();
      const texts = await overlay.locator(".content .buttons .btn").allTextContents();
      sides.add(texts.indexOf(card.options[0]) === 0 ? "left" : "right");
      await closeCard();
    }
    assert.equal(sides.size, 2, "the right answer appeared only on the " + [...sides][0]);
  });

  await step("two ads in a row: a short gap between them does not interrupt the card", async () => {
    await reset({});
    await setAd(true);
    await overlay.waitFor();
    await page.evaluate(() => {
      const p = document.querySelector("#movie_player");
      p.classList.remove("ad-showing");
      setTimeout(() => p.classList.add("ad-showing"), 100);
    });
    await page.waitForTimeout(700);
    assert.equal(await overlay.locator("text=Back to video").count(), 0, "must still be in ad mode");
    const v = await vid();
    assert.equal(v.paused, false, "the second ad must not be paused");
    assert.equal(v.muted, true);
  });

  await step("a new ad right after a break is never held back", async () => {
    await setAd(false);
    await overlay.locator("text=Back to video").waitFor();
    assert.equal((await vid()).paused, true);
    await setAd(true); // the next ad starts while the video was waiting for the choice
    await page.waitForFunction(() => !document.querySelector("video").paused);
    assert.equal((await vid()).muted, true);
    assert.equal(await overlay.locator("text=Back to video").count(), 0);
    await closeCard();
  });

  await step("every card fills the player: nothing to scroll, no empty area, also in fullscreen", async () => {
    const measure = () => page.evaluate(() => {
      const root = document.querySelector("#lta-overlay").shadowRoot;
      const content = root.querySelector(".content");
      const inner = root.querySelector(".inner");
      const footer = root.querySelector(".footer").getBoundingClientRect();
      const host = document.querySelector("#lta-overlay").getBoundingClientRect();
      return {
        scrolls: content.scrollHeight > content.clientHeight,
        filled: inner.offsetHeight / content.clientHeight,
        footerInside: footer.bottom <= host.bottom + 0.5,
        font: parseFloat(getComputedStyle(root.querySelector(".panel")).fontSize),
      };
    });
    const resizePlayer = (w, h) => page.evaluate(([w, h]) => {
      const p = document.querySelector("#movie_player");
      p.style.width = w + "px";
      p.style.height = h + "px";
    }, [w, h]);
    await page.setViewportSize({ width: 1700, height: 1000 });
    for (const card of allCards) {
      const others = allCards.filter((c) => c.id !== card.id).map((c) => ({ type: "show", id: c.id, t: Date.now() }));
      await worker.evaluate((events) => chrome.storage.local.set({ events, settings: {} }), others);
      await setAd(true);
      await overlay.waitFor();
      await showSkip(true); // worst case: the skip hint is showing too
      await overlay.locator(".skiphint:visible").waitFor();
      const fonts = {};
      for (const [w, h] of [[854, 480], [640, 360], [1600, 900]]) {
        await resizePlayer(w, h);
        await page.waitForTimeout(150);
        const m = await measure();
        fonts[w] = m.font;
        assert.equal(m.scrolls, false, `${card.id} at ${w}x${h} before the answer: must not scroll`);
        assert.equal(m.footerInside, true, `${card.id} at ${w}x${h}: footer must be inside the player`);
        // Text grows in whole lines: one more line can tip a card over, so a short card on a small
        // player with the Skip opening may keep up to about one line free (cs-05-002 at 640x360: 90 %).
        assert.ok(m.filled > 0.85, `${card.id} at ${w}x${h}: only ${Math.round(m.filled * 100)} % of the height used`);
      }
      assert.ok(fonts[1600] > fonts[854] && fonts[854] > fonts[640], `${card.id}: text must grow with the player ${JSON.stringify(fonts)}`);
      await resizePlayer(854, 480);
      await page.waitForTimeout(150);
      const before = await measure();
      await answerCorrectly(overlay);
      const after = await measure();
      assert.equal(after.scrolls, false, `${card.id} with the answer showing: must not scroll`);
      assert.equal(after.font, before.font, `${card.id}: text size must not jump when the answer appears`);
      assert.deepEqual(await footerButtons(), ["Next card"]);
      const next = await overlay.locator(".footer .btn:visible").boundingBox();
      const skipBox = await page.locator(".ytp-skip-ad-button").boundingBox();
      const apart = next.x + next.width <= skipBox.x || next.y + next.height <= skipBox.y || next.y >= skipBox.y + skipBox.height;
      assert.ok(apart, `${card.id}: 'Next card' must not reach into the Skip button`);
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `fit-${card.type}.png`), clip: { x: 0, y: 0, width: 854, height: 480 } });
      await showSkip(false);
      await closeCard();
    }
    await page.setViewportSize({ width: 1000, height: 600 });
  });

  await step("fullscreen: the card keeps the top free while Chrome shows its 'Press Esc' notice", async () => {
    await reset({});
    await setAd(true);
    await overlay.waitFor();
    const state = () => page.evaluate(() => {
      const root = document.querySelector("#lta-overlay").shadowRoot;
      const panel = root.querySelector(".panel");
      const content = root.querySelector(".content");
      return {
        fullscreen: !!document.fullscreenElement,
        free: panel.classList.contains("esc-space"),
        top: root.querySelector(".top").getBoundingClientRect().top,
        scrolls: content.scrollHeight > content.clientHeight,
        font: parseFloat(getComputedStyle(panel).fontSize),
      };
    });
    assert.equal((await state()).free, false, "no gap outside fullscreen");
    await page.mouse.click(950, 580); // outside the player, so the key goes to the page
    await page.keyboard.press("f");
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.waitForTimeout(200);
    const during = await state();
    assert.equal(during.free, true, "top must be kept free right after entering fullscreen");
    assert.ok(during.top >= 70, "card text starts below the notice, at " + during.top);
    assert.equal(during.scrolls, false);
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "10-fullscreen-esc-space.png") });
    await page.waitForTimeout(4600);
    const after = await state();
    assert.equal(after.free, false, "after a few seconds the card moves back up");
    assert.ok(after.top < 70);
    assert.equal(after.scrolls, false);
    assert.ok(after.font >= during.font);
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.fullscreenElement);
    await closeCard();
  });

  assert.deepEqual(errors, [], "page errors: " + errors.join("; "));
  await context.close();
  console.log(`\nall ${steps.length} browser tests passed`);
})().catch((err) => {
  console.error("FAIL", err.message);
  process.exit(1);
});
