// Everything the extension remembers. It stays in this browser (chrome.storage.local);
// nothing is sent anywhere.
(function (root) {
  const LTA = root.LTA || (root.LTA = {});

  // Writes are queued so two quick answers can never overwrite each other.
  let queue = Promise.resolve();
  function serial(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  LTA.store = {
    async getEvents() {
      const { events = [] } = await chrome.storage.local.get("events");
      return events;
    },

    // event: { type: "show", id, t } or { type: "answer", id, t, ok, ms }
    addEvent(event) {
      return serial(async () => {
        const events = await LTA.store.getEvents();
        events.push(event);
        await chrome.storage.local.set({ events });
      });
    },

    // value: "up", "neutral" or "down". The latest rating per card wins.
    setRating(cardId, value) {
      return serial(async () => {
        const { ratings = {} } = await chrome.storage.local.get("ratings");
        ratings[cardId] = { value, t: Date.now() };
        await chrome.storage.local.set({ ratings });
      });
    },
  };
})(typeof self !== "undefined" ? self : globalThis);
