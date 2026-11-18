// Runs in the background and hands the cards to the YouTube tab, the settings window and practice mode.
//
// Code and content are separate: the cards are loaded from GitHub, so new cards arrive without
// downloading the extension again. The last cards loaded are kept in this browser, so everything
// works offline too. The cards packed into the extension (folder "cards") are only the starting
// set until the first online load works.
// Only the card files are downloaded. Nothing about the user is sent anywhere.

importScripts("selection.js"); // LTA.isUsableCard

const SUBJECT_FILES = ["computer_science", "mathematics", "economics", "psychology"];
const ONLINE_BASE = "https://raw.githubusercontent.com/5akul/learn_through_ads_cards/main/cards/";
const CHECK_EVERY_MS = 30 * 60 * 1000; // look for new cards at most every 30 minutes

// Reads every subject file from GitHub. A missing file (404) means "no cards for this subject".
// Any other problem (offline, server error, broken file) gives null: then nothing is replaced.
async function loadOnline() {
  const all = [];
  for (const subject of SUBJECT_FILES) {
    const res = await fetch(`${ONLINE_BASE}${subject}.json`, { cache: "no-store" });
    if (res.status === 404) continue;
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.cards)) return null;
    all.push(...data.cards.filter(LTA.isUsableCard));
  }
  return all;
}

// The cards packed into the extension. A subject without a file is simply skipped
// (inside an extension a missing file is an error, not a 404).
async function packedCards() {
  const all = [];
  for (const subject of SUBJECT_FILES) {
    try {
      const res = await fetch(chrome.runtime.getURL(`cards/${subject}.json`));
      const data = await res.json();
      if (Array.isArray(data.cards)) all.push(...data.cards.filter(LTA.isUsableCard));
    } catch (err) {
      // no file for this subject
    }
  }
  return all;
}

// Downloads the newest cards. Keeps the old ones if anything goes wrong or the result is empty.
async function refreshCards() {
  const checked = Date.now();
  let cards = null;
  try {
    cards = await loadOnline();
  } catch (err) {
    cards = null;
  }
  const { cardCache } = await chrome.storage.local.get("cardCache");
  if (cards && cards.length) {
    await chrome.storage.local.set({ cardCache: { cards, loaded: checked, checked } });
    return { ok: true, count: cards.length };
  }
  if (cardCache) await chrome.storage.local.set({ cardCache: { ...cardCache, checked } });
  else await chrome.storage.local.set({ cardCheck: checked });
  return { ok: false };
}
self.refreshCards = refreshCards; // used by the browser tests

let refreshing = null;
function refreshInBackground() {
  if (!refreshing) refreshing = refreshCards().finally(() => (refreshing = null));
  return refreshing;
}

// Answers at once with the cards there are; looks for newer ones in the background.
async function getCards() {
  const { cardCache, cardCheck = 0 } = await chrome.storage.local.get(["cardCache", "cardCheck"]);
  const lastCheck = cardCache ? cardCache.checked : cardCheck;
  if (Date.now() - lastCheck > CHECK_EVERY_MS) refreshInBackground();
  if (cardCache && cardCache.cards.length) return cardCache.cards;
  return packedCards();
}

async function cardInfo() {
  const { cardCache } = await chrome.storage.local.get("cardCache");
  return cardCache ? { online: true, loaded: cardCache.loaded } : { online: false };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = { getCards, cardInfo, refreshCards: refreshInBackground };
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  handler().then(sendResponse, () => sendResponse(msg.type === "getCards" ? [] : null));
  return true; // answer comes later (async)
});
