// The settings window that opens when you click the extension icon.
(async function () {
  const LTA = self.LTA;
  const SUBJECTS = {
    computer_science: "Computer Science",
    mathematics: "Mathematics",
    economics: "Economics",
    psychology: "Psychology",
  };

  const [cards, events, settings] = await Promise.all([
    chrome.runtime.sendMessage({ type: "getCards" }).catch(() => []),
    LTA.store.getEvents(),
    LTA.store.getSettings(),
  ]);

  // ---- Small status line
  const now = Date.now();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = events.filter((e) => e.type === "answer" && e.t >= midnight.getTime());
  const correct = today.filter((e) => e.ok).length;
  document.getElementById("stats").textContent =
    `🔥 ${LTA.streak(events, now)} day streak · today ${correct} of ${today.length} correct`;

  // ---- Current chapter: one menu per subject that has cards
  const box = document.getElementById("chapters");
  const bySubject = {};
  for (const c of cards || []) {
    (bySubject[c.subject] = bySubject[c.subject] || new Map()).set(c.chapter, c.chapter_title || "");
  }
  for (const subject of Object.keys(SUBJECTS)) {
    const chapters = bySubject[subject];
    if (!chapters) continue;
    const select = document.createElement("select");
    select.dataset.subject = subject;
    select.append(new Option("not set", ""));
    for (const [number, title] of [...chapters].sort((a, b) => a[0] - b[0])) {
      select.append(new Option(`${number} · ${title}`, String(number)));
    }
    select.value = settings.currentChapter[subject] != null ? String(settings.currentChapter[subject]) : "";
    select.addEventListener("change", async () => {
      const current = { ...(await LTA.store.getSettings()).currentChapter };
      if (select.value === "") delete current[subject];
      else current[subject] = Number(select.value);
      await LTA.store.setSettings({ currentChapter: current });
    });
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("span");
    label.textContent = SUBJECTS[subject];
    row.append(label, select);
    box.append(row);
  }
  if (!box.children.length) box.textContent = "No cards found.";

  // ---- Exam mode
  const examOn = document.getElementById("examOn");
  const examCount = document.getElementById("examCount");
  examOn.checked = settings.minCorrect > 0;
  examCount.value = settings.examCount || settings.minCorrect || 3;
  const saveExam = () => {
    const n = Math.min(20, Math.max(1, Math.round(Number(examCount.value) || 3)));
    examCount.value = n;
    LTA.store.setSettings({ examCount: n, minCorrect: examOn.checked ? n : 0 });
  };
  examOn.addEventListener("change", saveExam);
  examCount.addEventListener("change", saveExam);

  // ---- Where the cards come from
  const infoEl = document.getElementById("cardInfo");
  const showInfo = async (count) => {
    const info = await chrome.runtime.sendMessage({ type: "cardInfo" }).catch(() => null);
    const when = info && info.online
      ? "updated " + new Date(info.loaded).toLocaleString([], { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })
      : "from the extension folder";
    infoEl.textContent = `${count} cards, ${when}.`;
  };
  showInfo((cards || []).length);
  const updateBtn = document.getElementById("update");
  updateBtn.addEventListener("click", async () => {
    updateBtn.disabled = true;
    updateBtn.textContent = "Checking…";
    const result = await chrome.runtime.sendMessage({ type: "refreshCards" }).catch(() => null);
    if (result && result.ok) {
      await showInfo(result.count);
      updateBtn.textContent = "Done. Reload YouTube to use them.";
    } else {
      updateBtn.textContent = "No connection. The last cards stay.";
    }
  });

  // ---- Manual mode
  document.getElementById("practice").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("practice.html") });
  });
})();
