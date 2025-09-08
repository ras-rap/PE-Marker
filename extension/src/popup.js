document.addEventListener("DOMContentLoaded", () => {
  const reduceMotionEl = document.getElementById("reduceMotion");
  const violenceLevelEl = document.getElementById("violenceLevel");
  const violenceValueEl = document.getElementById("violenceValue");
  const saveStatusEl = document.getElementById("saveStatus");

  // Load settings
  chrome.storage.sync.get({ reduceMotion: false, violenceLevel: 1.0 }, (settings) => {
    reduceMotionEl.checked = settings.reduceMotion;
    violenceLevelEl.value = settings.violenceLevel;
    violenceValueEl.textContent = settings.violenceLevel.toFixed(1) + "x";
  });

  // Update label live
  violenceLevelEl.addEventListener("input", (e) => {
    violenceValueEl.textContent = parseFloat(e.target.value).toFixed(1) + "x";
    saveSettings();
  });

  reduceMotionEl.addEventListener("change", saveSettings);

  function saveSettings() {
    const reduceMotion = reduceMotionEl.checked;
    const violenceLevel = parseFloat(violenceLevelEl.value);
    chrome.storage.sync.set({ reduceMotion, violenceLevel }, () => {
      saveStatusEl.classList.add("show");
      setTimeout(() => saveStatusEl.classList.remove("show"), 1000);
    });
  }
});