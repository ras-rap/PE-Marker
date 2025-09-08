document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.sync.get({ reduceMotion: false, violenceLevel: 1.0 }, (settings) => {
    document.getElementById("reduceMotion").checked = settings.reduceMotion;
    document.getElementById("violenceLevel").value = settings.violenceLevel;
    document.getElementById("violenceValue").textContent = settings.violenceLevel.toFixed(1) + "x";
  });

  document.getElementById("violenceLevel").addEventListener("input", (e) => {
    document.getElementById("violenceValue").textContent = parseFloat(e.target.value).toFixed(1) + "x";
  });

  document.getElementById("save").addEventListener("click", () => {
    const reduceMotion = document.getElementById("reduceMotion").checked;
    const violenceLevel = parseFloat(document.getElementById("violenceLevel").value);
    chrome.storage.sync.set({ reduceMotion, violenceLevel }, () => {
      alert("Settings saved!");
    });
  });
});