// Runs on youtube.com. Watches the player, notices when an ad starts and ends,
// mutes the ad, and opens or closes the card window.
//
// How the ad is detected: while an ad plays, YouTube adds the class "ad-showing"
// to the player element (#movie_player). YouTube changes its page from time to time;
// if cards stop appearing, this is the first place to check.
(function () {
  const LTA = self.LTA;

  const PLAYER_SELECTOR = "#movie_player";
  const AD_CLASS = "ad-showing";
  // Right after an ad, YouTube starts the video by itself. During this time
  // we pause it again, so the choice "keep learning / back to video" stays open.
  const AUTOPLAY_GUARD_MS = 3000;
  const AD_END_DELAY_MS = 250;
  // Names YouTube has used for its "Skip ad" button. Checked in this order.
  const SKIP_BUTTON_SELECTORS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-container button",
    'button[class*="skip"]',
  ];

  let player = null;
  let observer = null;
  let inAd = false;
  let overlay = null;
  let cards = null;
  let progressTimer = null;
  let savedMuted = null;
  let guardUntil = 0;
  let settings = { currentChapter: {}, minCorrect: 0 };
  let correctThisBreak = 0;
  let heldByUs = false; // we paused the video after an ad and it is still waiting
  let endTimer = null;
  const watchedVideos = new WeakSet();

  function getVideo() {
    if (!player) return null;
    return player.querySelector("video.html5-main-video") || player.querySelector("video");
  }

  async function loadCards() {
    if (cards && cards.length) return cards;
    try {
      const list = await chrome.runtime.sendMessage({ type: "getCards" });
      cards = (list || []).filter(LTA.isUsableCard);
    } catch (err) {
      cards = null; // try again at the next ad
      return [];
    }
    return cards;
  }

  async function pickNext() {
    const [list, events, loaded] = await Promise.all([loadCards(), LTA.store.getEvents(), LTA.store.getSettings()]);
    settings = loaded;
    const now = Date.now();
    return { card: LTA.pickCard(list, events, now, settings), streak: LTA.streak(events, now) };
  }

  // ---- Exam mode: the video only continues after a number of correct answers.
  // The user switches this on themselves in the settings and can switch it off there at any time.
  function lockRemaining() {
    return Math.max(0, (Number(settings.minCorrect) || 0) - correctThisBreak);
  }

  function updateLock() {
    if (overlay) overlay.setLock(lockRemaining());
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    settings = { currentChapter: {}, minCorrect: 0, ...changes.settings.newValue };
    updateLock();
  });

  function show(card, streak) {
    overlay.showCard(card, { streak });
    LTA.store.addEvent({ type: "show", id: card.id, t: Date.now() });
  }

  const handlers = {
    onAnswer(card, ok, ms) {
      LTA.store.addEvent({ type: "answer", id: card.id, t: Date.now(), ok, ms });
      if (ok) correctThisBreak++;
      updateLock();
    },
    onRate(card, value) {
      LTA.store.setRating(card.id, value);
    },
    async onNext() {
      const { card, streak } = await pickNext();
      if (card && overlay) show(card, streak);
    },
    onBack() {
      if (lockRemaining() > 0) return;
      closeOverlay();
      const video = getVideo();
      if (video) video.play().catch(() => {});
    },
  };

  // YouTube's Skip button, but only once it can really be clicked.
  // The extension never clicks it. It only tells the user it is there and keeps it reachable.
  function findSkipButton() {
    if (!player) return null;
    for (const selector of SKIP_BUTTON_SELECTORS) {
      for (const el of player.querySelectorAll(selector)) {
        if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
        const box = el.getBoundingClientRect();
        if (box.width < 20 || box.height < 10) continue;
        const visible = typeof el.checkVisibility === "function"
          ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          : getComputedStyle(el).visibility !== "hidden";
        if (visible) return el;
      }
    }
    return null;
  }

  function closeOverlay() {
    if (overlay) overlay.destroy();
    overlay = null;
    heldByUs = false;
  }

  // ---- Muting: the ad keeps playing, only the sound is off. Afterwards the old state comes back.
  function muteForAd() {
    const video = getVideo();
    if (!video) return;
    if (savedMuted === null) savedMuted = video.muted;
    video.muted = true;
  }

  function restoreSound() {
    const video = getVideo();
    if (video && savedMuted !== null) video.muted = savedMuted;
    savedMuted = null;
  }

  // ---- Ad start and end
  async function onAdStart() {
    inAd = true;
    if (heldByUs) {
      // The next ad of the same break started while we were holding the video. Never hold an ad.
      heldByUs = false;
      const video = getVideo();
      if (video && video.paused) video.play().catch(() => {});
    }
    muteForAd();
    startProgress();
    if (overlay) {
      // Second ad in a row, or an ad while the choice was still open: keep the card.
      overlay.setMode("ad");
      return;
    }
    const { card, streak } = await pickNext();
    if (!card || !inAd || overlay || !player) return;
    correctThisBreak = 0;
    overlay = new LTA.Overlay(player, handlers);
    updateLock();
    show(card, streak);
  }

  function onAdEnd() {
    inAd = false;
    stopProgress();
    restoreSound();
    if (!overlay) return;
    overlay.setSkipButton(null);
    overlay.setMode("after");
    const video = getVideo();
    guardUntil = Date.now() + AUTOPLAY_GUARD_MS;
    if (video) {
      video.pause();
      heldByUs = true;
    }
  }

  function startProgress() {
    stopProgress();
    progressTimer = setInterval(() => {
      const video = getVideo();
      if (!overlay || !video) return;
      overlay.setSkipButton(findSkipButton());
      if (Number.isFinite(video.duration) && video.duration > 0) {
        overlay.setAdProgress(
          video.currentTime / video.duration,
          Math.max(0, Math.ceil(video.duration - video.currentTime))
        );
      }
    }, 250);
  }

  function stopProgress() {
    clearInterval(progressTimer);
    progressTimer = null;
  }

  // ---- Video events
  function watchVideo(video) {
    if (!video || watchedVideos.has(video)) return;
    watchedVideos.add(video);

    // A new ad in the same break may switch the sound back on. Mute it again.
    const keepMuted = () => {
      if (inAd) video.muted = true;
    };
    video.addEventListener("loadeddata", keepMuted);
    video.addEventListener("playing", keepMuted);

    video.addEventListener("play", () => {
      if (!overlay || inAd) return;
      if (Date.now() < guardUntil || lockRemaining() > 0) {
        video.pause(); // YouTube's own autoplay after the ad, or exam mode not done yet
      } else {
        closeOverlay(); // the user pressed play in YouTube: they chose the video
      }
    });
  }

  // ---- Finding the player (YouTube builds the page step by step and swaps parts of it)
  function checkAdState() {
    if (!player) return;
    watchVideo(getVideo());
    const adShowing = player.classList.contains(AD_CLASS);
    if (adShowing) {
      clearTimeout(endTimer);
      endTimer = null;
      if (!inAd) onAdStart();
    } else if (inAd && !endTimer) {
      // Between two ads of one break the mark can disappear for a moment.
      // Wait briefly and look again before treating the ad as over.
      endTimer = setTimeout(() => {
        endTimer = null;
        if (inAd && player && !player.classList.contains(AD_CLASS)) onAdEnd();
      }, AD_END_DELAY_MS);
    }
  }

  function bindPlayer() {
    const found = document.querySelector(PLAYER_SELECTOR);
    if (found === player) return;
    if (observer) observer.disconnect();
    clearTimeout(endTimer);
    endTimer = null;
    closeOverlay();
    stopProgress();
    inAd = false;
    savedMuted = null;
    player = found;
    if (!player) return;
    observer = new MutationObserver(checkAdState);
    observer.observe(player, { attributes: true, attributeFilter: ["class"] });
    checkAdState();
  }

  // When you click to another video, an open choice window is closed.
  document.addEventListener("yt-navigate-start", () => {
    if (!inAd) closeOverlay();
  });

  // After the extension was updated or reloaded, this old copy of the script can no longer
  // talk to it. Then it cleans up after itself; the new version takes over on the next page load.
  function extensionAlive() {
    try {
      return !!chrome.runtime.id;
    } catch (err) {
      return false;
    }
  }

  const ticker = setInterval(() => {
    if (extensionAlive()) {
      bindPlayer();
      return;
    }
    clearInterval(ticker);
    clearTimeout(endTimer);
    if (observer) observer.disconnect();
    stopProgress();
    if (inAd) restoreSound();
    inAd = false;
    closeOverlay();
  }, 1000);
  bindPlayer();
})();
