// Runs in the background and hands the cards to the YouTube tab.
// In version 1 the cards are packed into the extension (folder "cards").

const SUBJECT_FILES = ["computer_science", "mathematics", "economics", "psychology"];

let cardsPromise = null;

async function loadCards() {
  const all = [];
  for (const subject of SUBJECT_FILES) {
    try {
      const res = await fetch(chrome.runtime.getURL(`cards/${subject}.json`));
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data.cards)) all.push(...data.cards);
    } catch (err) {
      // A subject without a file (e.g. mathematics for now) is simply skipped.
    }
  }
  return all;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "getCards") {
    if (!cardsPromise) cardsPromise = loadCards();
    cardsPromise.then(sendResponse, () => sendResponse([]));
    return true; // answer comes later (async)
  }
  return false;
});
