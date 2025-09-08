// background.js

// In-memory cache for SVGs
const iconCache = {};

// Listen for icon requests from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getIcon") {
    const iconName = message.icon === "shill" ? "shill.svg" : "indie.svg";

    // If already cached, return immediately
    if (iconCache[iconName]) {
      sendResponse({ svg: iconCache[iconName] });
      return;
    }

    // Otherwise, fetch from backend
    fetch(`https://pem.ras-rap.click/api/icons/${iconName}`)
      .then((res) => res.text())
      .then((svgText) => {
        iconCache[iconName] = svgText; // store in memory
        sendResponse({ svg: svgText });
      })
      .catch((err) => {
        console.error("Icon fetch error:", err);
        sendResponse({ svg: "" });
      });

    // Keep the message channel open for async sendResponse
    return true;
  }
});