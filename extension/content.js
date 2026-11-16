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

  let player = null;
  let observer = null;
  let inAd = false;
  let overlay = null;
  let cards = null;
  let progressTimer = null;
  let savedMuted = null;
  let guardUntil = 0;
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
    const [list, events] = await Promise.all([loadCards(), LTA.store.getEvents()]);
    const now = Date.now();
    return { card: LTA.pickCard(list, events, now), streak: LTA.streak(events, now) };
  }

  function show(card, streak) {
    overlay.showCard(card, { streak });
    LTA.store.addEvent({ type: "show", id: card.id, t: Date.now() });
  }

  const handlers = {
    onAnswer(card, ok, ms) {
      LTA.store.addEvent({ type: "answer", id: card.id, t: Date.now(), ok, ms });
    },
    onRate(card, value) {
      LTA.store.setRating(card.id, value);
    },
    async onNext() {
      const { card, streak } = await pickNext();
      if (card && overlay) show(card, streak);
    },
    onBack() {
      closeOverlay();
      const video = getVideo();
      if (video) video.play().catch(() => {});
    },
  };

  function closeOverlay() {
    if (overlay) overlay.destroy();
    overlay = null;
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
    muteForAd();
    startProgress();
    if (overlay) {
      // Second ad in a row, or an ad while the choice was still open: keep the card.
      overlay.setMode("ad");
      return;
    }
    const { card, streak } = await pickNext();
    if (!card || !inAd || overlay || !player) return;
    overlay = new LTA.Overlay(player, handlers);
    show(card, streak);
  }

  function onAdEnd() {
    inAd = false;
    stopProgress();
    restoreSound();
    if (!overlay) return;
    overlay.setMode("after");
    const video = getVideo();
    guardUntil = Date.now() + AUTOPLAY_GUARD_MS;
    if (video) video.pause();
  }

  function startProgress() {
    stopProgress();
    progressTimer = setInterval(() => {
      const video = getVideo();
      if (!overlay || !video) return;
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
      if (Date.now() < guardUntil) {
        video.pause(); // YouTube's own autoplay after the ad
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
    if (adShowing && !inAd) onAdStart();
    else if (!adShowing && inAd) onAdEnd();
  }

  function bindPlayer() {
    const found = document.querySelector(PLAYER_SELECTOR);
    if (found === player) return;
    if (observer) observer.disconnect();
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

  setInterval(bindPlayer, 1000);
  bindPlayer();
})();
