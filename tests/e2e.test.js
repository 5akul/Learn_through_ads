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

  await step("YouTube's bottom bar and Skip button stay free", async () => {
    const o = await overlay.boundingBox();
    const p = await page.locator("#movie_player").boundingBox();
    const skip = await page.locator(".ytp-skip-ad-button").boundingBox();
    assert.ok(o.y + o.height <= p.y + p.height - 56 + 1, "overlay covers the controls");
    assert.ok(skip.x >= o.x + o.width, "overlay covers the Skip button");
    await page.locator(".ytp-skip-ad-button").click(); // must be clickable, not hidden behind the card
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
      await o.locator(".buttons .btn").first().click();
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
    const texts = await overlay.locator(".buttons .btn").allTextContents();
    assert.deepEqual([...texts].sort(), [...card.options].sort(), "exactly the two options as buttons");
    return card;
  };
  const optionButton = (text) => overlay.locator(".buttons .btn", { hasText: new RegExp(`^${text}$`) });
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
    assert.equal(await overlay.locator(".buttons .btn:disabled").count(), 2, "no second try");
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
      await scope.locator(".buttons .btn", { hasText: new RegExp(`^${card.options[0]}$`) }).click();
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

  assert.deepEqual(errors, [], "page errors: " + errors.join("; "));
  await context.close();
  console.log(`\nall ${steps.length} browser tests passed`);
})().catch((err) => {
  console.error("FAIL", err.message);
  process.exit(1);
});
