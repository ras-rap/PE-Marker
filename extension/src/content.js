// PE Checker Content Script
// - Adds icons on: channel pages, watch pages, search channel previews,
//   home/feed video cards, and watch page sidebar recommended cards
// - Prevents navigation when clicking the icon (so the modal can open)
// - Fixes modal closing behavior (outside click, X, and ESC)
// - Guards chrome.* calls to avoid "Extension context invalidated" errors

// ====================== Selectors ======================

const videoPageSelectors = [
  "ytd-video-owner-renderer #channel-name",
  "ytd-video-owner-renderer a.yt-simple-endpoint",
];

const channelPageSelector =
  "yt-dynamic-text-view-model h1.dynamic-text-view-model-wiz__h1";

const searchChannelSelector = "ytd-channel-renderer #channel-title";

// ====================== Caches / State ======================

const handleToChannelIdCache = new Map(); // "/@handle" -> "UC..."
const videoIdToChannelIdCache = new Map(); // "VIDEO_ID" -> "UC..."
let settingsCache = null;
let pageScriptsTextCache = null;

// ====================== Safe chrome.* wrappers ======================

function isExtensionAlive() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function getSettings() {
  if (settingsCache) return Promise.resolve(settingsCache);
  return new Promise((resolve) => {
    try {
      if (!isExtensionAlive()) {
        return resolve({ reduceMotion: false, violenceLevel: 1.0 });
      }
      chrome.storage.sync.get(
        { reduceMotion: false, violenceLevel: 1.0 },
        (settings) => {
          settingsCache = settings;
          resolve(settings);
        }
      );
    } catch {
      resolve({ reduceMotion: false, violenceLevel: 1.0 });
    }
  });
}

const extensionChannelCache = new Map(); // channelId -> { data, expires }

function fetchChannelData(channelId) {
  const fallback = {
    flagged: false,
    name: "Unknown",
    votesYes: 0,
    votesNo: 0,
    verificationStatus: 0,
    id: channelId,
    iconType: "indie",
  };

  return new Promise(async (resolve) => {
    try {
      const res = await fetch(
        `https://pem.ras-rap.click/api/channel/${encodeURIComponent(channelId)}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!res.ok) {
        return resolve(fallback);
      }

      const data = await res.json();

      const totalVotes = data.votesYes + data.votesNo;
      const yesPercent =
        totalVotes > 0 ? Math.round((data.votesYes / totalVotes) * 100) : 0;
      const noPercent = 100 - yesPercent;

      // Decide icon type
      let iconType = "indie";
      if (data.verificationStatus === 1) {
        iconType = "shill"; // Verified PE owned
      } else if (data.verificationStatus === 2) {
        iconType = "indie"; // Verified Independent
      } else {
        iconType = yesPercent > 50 ? "shill" : "indie"; // fallback to crowd vote
      }

      resolve({
        flagged: iconType === "shill",
        name: data.name || "Unknown",
        votesYes: yesPercent,
        votesNo: noPercent,
        verificationStatus: data.verificationStatus ?? 0,
        id: channelId,
        iconType,
      });
    } catch (err) {
      console.error("fetchChannelData error:", err);
      resolve(fallback);
    }
  });
}

// ====================== DOM helpers ======================

function waitForElement(selectors, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return resolve(el);
      }
      if (Date.now() - start > timeout) {
        return reject(
          new Error(
            "Timeout waiting for element: " + selectors.join(", ")
          )
        );
      }
      requestAnimationFrame(check);
    }
    check();
  });
}

function getPageScriptsText() {
  if (pageScriptsTextCache !== null) return pageScriptsTextCache;
  try {
    pageScriptsTextCache = Array.from(document.scripts)
      .map((s) => s.textContent || "")
      .join("\n");
  } catch {
    pageScriptsTextCache = "";
  }
  return pageScriptsTextCache;
}

function parseChannelIdFromScripts(textHint) {
  const text = getPageScriptsText();
  if (!text || !text.includes("channelId")) return null;
  if (textHint && !text.includes(textHint)) return null;
  const m = text.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/);
  return m ? m[1] : null;
}

// ====================== Resolvers (handle/video -> UC) ======================

async function resolveHandleToChannelId(handlePath) {
  if (!handlePath || !handlePath.startsWith("/@")) return null;

  if (handleToChannelIdCache.has(handlePath)) {
    return handleToChannelIdCache.get(handlePath);
  }

  // Try current page scripts first (cheap)
  const fromScripts = parseChannelIdFromScripts(handlePath);
  if (fromScripts) {
    handleToChannelIdCache.set(handlePath, fromScripts);
    return fromScripts;
  }

  // Same-origin fetch to the handle's page and scrape channelId
  try {
    const url = new URL(handlePath, location.origin).toString();
    const res = await fetch(url, { credentials: "include" });
    const html = await res.text();
    const match = html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/);
    if (match) {
      const id = match[1];
      handleToChannelIdCache.set(handlePath, id);
      return id;
    }
  } catch {
    // ignore fetch errors
  }
  return null;
}

async function resolveVideoIdToChannelId(videoId) {
  if (!videoId) return null;

  if (videoIdToChannelIdCache.has(videoId)) {
    return videoIdToChannelIdCache.get(videoId);
  }

  // Try current page scripts near the videoId
  const text = getPageScriptsText();
  if (text && text.includes(videoId)) {
    const re = new RegExp(
      `"videoId":"${videoId}"[\\s\\S]{0,1000}?"channelId":"(UC[0-9A-Za-z_-]{22})"`
    );
    const m = text.match(re);
    if (m) {
      const id = m[1];
      videoIdToChannelIdCache.set(videoId, id);
      return id;
    }
  }

  // Same-origin fetch to the video's watch page
  try {
    const url = new URL(`/watch?v=${videoId}`, location.origin).toString();
    const res = await fetch(url, { credentials: "include" });
    const html = await res.text();
    const match = html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/);
    if (match) {
      const id = match[1];
      videoIdToChannelIdCache.set(videoId, id);
      return id;
    }
  } catch {
    // ignore fetch errors
  }

  return null;
}

// ====================== Channel ID getters ======================

function getChannelId() {
  // 1) From /channel/ link in video owner (watch page)
  const directLink = document.querySelector(
    "ytd-video-owner-renderer a.yt-simple-endpoint[href*='/channel/']"
  );
  if (directLink) {
    return directLink.href.split("/channel/")[1];
  }

  // 2) From canonical link
  const canonical = document.querySelector("link[rel='canonical']");
  if (canonical) {
    const url = canonical.href;
    if (url.includes("/channel/")) {
      return url.split("/channel/")[1];
    }
    if (url.includes("/@")) {
      // Any /channel/ link in the DOM
      const channelLink = document.querySelector("a[href^='/channel/']");
      if (channelLink) {
        return channelLink.href.split("/channel/")[1];
      }
    }
  }

  // 3) Anywhere in DOM
  const anyChannelLink = document.querySelector("a[href*='/channel/']");
  if (anyChannelLink) {
    return anyChannelLink.href.split("/channel/")[1];
  }

  // 4) Parse from scripts
  const fromScripts = parseChannelIdFromScripts();
  if (fromScripts) return fromScripts;

  return null;
}

function getChannelIdFromElementSync(el) {
  // 1) Direct /channel/ link inside the element
  const channelLink = el.querySelector("a[href*='/channel/']");
  if (channelLink) {
    return channelLink.href.split("/channel/")[1];
  }
  return null;
}

async function getChannelIdFromElement(el) {
  // 1) Sync path (if there is a /channel/ link)
  const sync = getChannelIdFromElementSync(el);
  if (sync) return sync;

  // 2) Handle link -> resolve via scripts or fetch
  const handleLink = el.querySelector("a[href^='/@']");
  if (handleLink) {
    const handlePath = handleLink.getAttribute("href");
    const id = await resolveHandleToChannelId(handlePath);
    if (id) return id;
  }

  // 3) Try to extract a videoId from classes and resolve that
  const innerWithId = el.querySelector("[class*='content-id-']");
  if (innerWithId) {
    const match =
      Array.from(innerWithId.classList).find((c) =>
        c.startsWith("content-id-")
      ) || "";
    const vid = match.replace("content-id-", "");
    if (vid && vid.length === 11) {
      const id = await resolveVideoIdToChannelId(vid);
      if (id) return id;
    }
  }

  return null;
}

// ====================== Icon / Modal ======================

function insertIcon(data, container, settings) {
  // Prevent duplicates per container
  if (container.querySelector(".pe-checker-icon")) return;

  const wrapper = document.createElement("span");
  wrapper.className = "pe-checker-icon";
  wrapper.style.display = "inline-block";
  wrapper.style.marginLeft = "6px";
  wrapper.style.cursor = "pointer";
  wrapper.style.userSelect = "none";
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "button");
  wrapper.setAttribute(
    "aria-label",
    `${data.flagged ? "Flagged" : "Clear"} — open ownership details`
  );

// Request SVG from background and inline it
chrome.runtime.sendMessage(
  { type: "getIcon", icon: data.iconType },
  (response) => {
    if (response && response.svg) {
      const span = document.createElement("span");
      span.innerHTML = response.svg;

      const svg = span.querySelector("svg");
      if (svg) {
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
        svg.style.verticalAlign = "middle";
        svg.style.display = "inline-block";
      }

      wrapper.appendChild(span);
    } else {
      console.error("Failed to load icon SVG");
    }
  }
);

  // Tooltip
  
	let verificationText = "❌ Not Verified";
	if (data.verificationStatus === 1) {
	  verificationText = "✅ Verified PE Owned";
	} else if (data.verificationStatus === 2) {
	  verificationText = "✅ Verified Independent";
	}
	
	const tooltip = document.createElement("div");
	tooltip.textContent = `${data.name} • ${data.votesYes}% say PE owned • ${verificationText}`;
  tooltip.style.position = "fixed";
  tooltip.style.backgroundColor = data.flagged
    ? "rgba(40, 0, 0, 0.75)"
    : "rgba(0, 40, 0, 0.75)";
  tooltip.style.backdropFilter = "blur(8px) saturate(150%)";
  tooltip.style.webkitBackdropFilter = "blur(8px) saturate(150%)";
  tooltip.style.color = "#fff";
  tooltip.style.padding = "6px 12px";
  tooltip.style.borderRadius = "999px";
  tooltip.style.fontSize = "12px";
  tooltip.style.whiteSpace = "nowrap";
  tooltip.style.zIndex = "999999";
  tooltip.style.opacity = "0";
  tooltip.style.pointerEvents = "none";
  tooltip.style.transition = "opacity 0.25s ease, transform 0.25s ease";
  tooltip.style.boxShadow = "0 4px 20px rgba(0,0,0,0.3)";
  tooltip.style.transform = "translateY(5px)";
  document.body.appendChild(tooltip);

  wrapper.addEventListener("mouseenter", () => {
    const rect = wrapper.getBoundingClientRect();
    tooltip.style.left = rect.left + rect.width / 2 + "px";
    tooltip.style.top =
      rect.top - 10 + window.scrollY - tooltip.offsetHeight + "px";
    tooltip.style.transform = "translate(-50%, 0)";
    tooltip.style.opacity = "1";
  });
  wrapper.addEventListener("mouseleave", () => {
    tooltip.style.opacity = "0";
    tooltip.style.transform = "translate(-50%, 5px)";
  });

  // Prevent navigation when interacting with the icon
  const preventer = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }
  };

  wrapper.addEventListener("mousedown", preventer, { passive: false });
  wrapper.addEventListener("mouseup", preventer, { passive: false });
  wrapper.addEventListener("touchstart", preventer, { passive: false });
  wrapper.addEventListener("touchend", preventer, { passive: false });

  wrapper.addEventListener("click", (e) => {
    preventer(e);
    createModal();
  });

  wrapper.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      preventer(e);
      createModal();
    }
  });

  // Modal creation
  function createModal() {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(0,0,0,0.6)";
    overlay.style.zIndex = "1000000";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity 0.3s ease";

    const modal = document.createElement("div");
    modal.style.backgroundColor = "rgba(30, 30, 30, 0.85)";
    modal.style.backdropFilter = "blur(12px) saturate(150%)";
    modal.style.webkitBackdropFilter = "blur(12px) saturate(150%)";
    modal.style.color = "#fff";
    modal.style.padding = "20px";
    modal.style.borderRadius = "12px";
    modal.style.width = "340px";
    modal.style.boxShadow = "0 8px 32px rgba(0,0,0,0.4)";
    modal.style.textAlign = "center";
    modal.style.fontFamily = "Segoe UI, Helvetica Neue, Arial, sans-serif";
    modal.style.position = "relative";
    modal.style.transform = "scale(0.9)";
    modal.style.opacity = "0";
    modal.style.transition = "opacity 0.3s ease, transform 0.3s ease";

    const closeBtn = document.createElement("span");
    closeBtn.textContent = "✖";
    closeBtn.style.position = "absolute";
    closeBtn.style.top = "15px";
    closeBtn.style.right = "20px";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.fontSize = "16px";
    closeBtn.style.color = "#fff";

    const title = document.createElement("h2");
    title.textContent = data.name;
    title.style.marginBottom = "10px";
    title.style.fontWeight = "600";

    let verificationText = "❌ Not Verified";
if (data.verificationStatus === 1) {
  verificationText = "✅ Verified PE Owned";
} else if (data.verificationStatus === 2) {
  verificationText = "✅ Verified Independent";
}

const info = document.createElement("p");
info.textContent = `${data.votesYes}% say PE owned • ${verificationText}`;
info.style.marginBottom = "15px";
info.style.opacity = "0.85";

    const barContainer = document.createElement("div");
    barContainer.style.width = "100%";
    barContainer.style.height = "20px";
    barContainer.style.backgroundColor = "#444";
    barContainer.style.borderRadius = "10px";
    barContainer.style.overflow = "hidden";
    barContainer.style.marginBottom = "20px";
    barContainer.style.position = "relative";

    const yesBar = document.createElement("div");
    yesBar.style.position = "absolute";
    yesBar.style.left = "0";
    yesBar.style.top = "0";
    yesBar.style.height = "100%";
    yesBar.style.width = "0%";
    yesBar.style.backgroundColor = "rgba(255, 50, 0, 0.95)";
    yesBar.style.transition = settings.reduceMotion
      ? "none"
      : "width 0.6s cubic-bezier(0.9, 0.05, 0.1, 1.4)";

    const noBar = document.createElement("div");
    noBar.style.position = "absolute";
    noBar.style.right = "0";
    noBar.style.top = "0";
    noBar.style.height = "100%";
    noBar.style.width = "0%";
    noBar.style.backgroundColor = "rgba(0, 200, 0, 0.95)";
    noBar.style.transition = settings.reduceMotion
      ? "none"
      : "width 0.6s cubic-bezier(0.9, 0.05, 0.1, 1.4)";

    barContainer.appendChild(yesBar);
    barContainer.appendChild(noBar);

    function createSparks(x, y) {
      if (settings.reduceMotion) return;
      const sparkCount = Math.floor(35 * settings.violenceLevel);
      for (let i = 0; i < sparkCount; i++) {
        const spark = document.createElement("div");
        spark.style.position = "absolute";
        spark.style.left = `${x}px`;
        spark.style.top = `${y}px`;
        spark.style.width = `${Math.random() * 3 + 2}px`;
        spark.style.height = `${Math.random() * 12 + 6}px`;
        spark.style.background =
          "linear-gradient(to bottom, rgba(255,255,220,1)," +
          " rgba(255,180,0,0.9), rgba(255,100,0,0.8))";
        spark.style.borderRadius = "50%";
        spark.style.opacity = "1";
        spark.style.pointerEvents = "none";
        spark.style.zIndex = "999999";
        spark.style.transformOrigin = "center";
        spark.style.boxShadow =
          "0 0 8px rgba(255,200,0,0.9), 0 0 15px rgba(255,150,0,0.7)";

        const angle = Math.random() * Math.PI * 2;
        const distance =
          (Math.random() * 60 + 30) * settings.violenceLevel;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        const rotation = Math.random() * 360;

        spark.animate(
          [
            {
              transform: `translate(0,0) rotate(${rotation}deg) scaleY(1)`,
              opacity: 1,
            },
            {
              transform: `translate(${dx}px, ${dy}px) rotate(${rotation}deg) scaleY(0.3)`,
              opacity: 0,
            },
          ],
          {
            duration:
              (800 + Math.random() * 300) * settings.violenceLevel,
            easing: "ease-out",
          }
        );

        barContainer.appendChild(spark);
        setTimeout(
          () => spark.remove(),
          1200 * settings.violenceLevel
        );
      }
    }

    function impactFlash(x) {
      if (settings.reduceMotion) return;
      const flash = document.createElement("div");
      flash.style.position = "absolute";
      flash.style.left = `${x - 5}px`;
      flash.style.top = "0";
      flash.style.width = "10px";
      flash.style.height = "100%";
      flash.style.background = "rgba(255,255,200,0.9)";
      flash.style.boxShadow = "0 0 15px rgba(255,255,150,0.9)";
      flash.style.zIndex = "5";
      barContainer.appendChild(flash);

      flash.animate(
        [
          { opacity: 1, transform: "scaleX(1)" },
          { opacity: 0, transform: "scaleX(2)" },
        ],
        { duration: 150, easing: "ease-out" }
      );

      setTimeout(() => flash.remove(), 200);
    }

    function shakeContainer() {
      if (settings.reduceMotion) return;
      const shakeAmount = 3 * settings.violenceLevel;
      barContainer.animate(
        [
          { transform: "translateX(0)" },
          { transform: `translateX(-${shakeAmount}px)` },
          { transform: `translateX(${shakeAmount}px)` },
          { transform: "translateX(0)" },
        ],
        { duration: 150 * settings.violenceLevel, iterations: 2 }
      );
    }

    function makeButton(text, bg) {
      const btn = document.createElement("button");
      btn.textContent = text;
      btn.style.background = bg;
      btn.style.color = "#fff";
      btn.style.border = "none";
      btn.style.padding = "10px 15px";
      btn.style.margin = "0 5px";
      btn.style.borderRadius = "8px";
      btn.style.cursor = "pointer";
      btn.style.fontSize = "14px";
      btn.style.transition =
        "background 0.2s ease, transform 0.2s ease";
      btn.addEventListener("mouseenter", () => {
        btn.style.transform = "scale(1.05)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.transform = "scale(1)";
      });
      return btn;
    }

    const yesBtn = makeButton("Yes, PE Owned", "rgba(200, 0, 0, 0.9)");
yesBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  try {
    await fetch("https://pem.ras-rap.click/api/vote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channelId: data.id || channelId || "", // ensure we send the ID
        vote: "yes",
      }),
    });
    alert("Vote recorded: PE Owned");
  } catch (err) {
    console.error("Vote error:", err);
    alert("Failed to record vote");
  }
  closeModal();
});

const noBtn = makeButton("No, Independent", "rgba(0, 150, 0, 0.9)");
noBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  try {
    await fetch("https://pem.ras-rap.click/api/vote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channelId: data.id || channelId || "",
        vote: "no",
      }),
    });
    alert("Vote recorded: Independent");
  } catch (err) {
    console.error("Vote error:", err);
    alert("Failed to record vote");
  }
  closeModal();
});

    // Build and wire modal/overlay
    modal.addEventListener("click", (e) => e.stopPropagation());
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
    });

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(info);
    modal.appendChild(barContainer);
    modal.appendChild(yesBtn);
    modal.appendChild(noBtn);
    overlay.appendChild(modal);

    // Click outside modal closes it
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      }
    });

    // ESC key closes it
    const escHandler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      }
    };
    document.addEventListener("keydown", escHandler, { capture: true });

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
      modal.style.opacity = "1";
      modal.style.transform = "scale(1)";
      yesBar.style.width = `${data.votesYes}%`;
      noBar.style.width = `${data.votesNo}%`;

      setTimeout(() => {
        const meetingPoint =
          (barContainer.clientWidth * data.votesYes) / 100;
        impactFlash(meetingPoint);
        createSparks(meetingPoint, barContainer.clientHeight / 2);
        shakeContainer();
      }, settings.reduceMotion ? 0 : 600);
    });

    function closeModal() {
      overlay.style.opacity = "0";
      modal.style.transform = "scale(0.9)";
      modal.style.opacity = "0";
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.removeEventListener("keydown", escHandler, {
          capture: true,
        });
      }, 300);
    }
  }

  // Insert after verified badge if exists, else append to container
  const verifiedBadge = container.querySelector(
    "ytd-badge-supported-renderer .badge-style-type-verified"
  );
  if (verifiedBadge && verifiedBadge.parentNode) {
    verifiedBadge.parentNode.insertBefore(
      wrapper,
      verifiedBadge.nextSibling
    );
  } else {
    container.appendChild(wrapper);
  }
}

// ====================== Page-level insertion ======================

let lastCheckTime = 0;
function debounceCheckChannel() {
  const now = Date.now();
  if (now - lastCheckTime < 2000) return; // skip if called too soon
  lastCheckTime = now;
  checkChannel();
}

async function checkChannel() {
  const channelId = getChannelId();
  if (!channelId) return;

  const settings = await getSettings();
  const data = await fetchChannelData(channelId);
  data.id = channelId; // store for voting

  if (
    location.pathname.startsWith("/channel/") ||
    location.pathname.startsWith("/@")
  ) {
    try {
      const h1 = await waitForElement([channelPageSelector], 10000);
      insertIcon(data, h1, settings);
    } catch {}
  } else if (location.pathname.startsWith("/results")) {
    try {
      const container = await waitForElement(
        [searchChannelSelector],
        10000
      );
      insertIcon(data, container, settings);
    } catch {}
  } else if (location.pathname.startsWith("/watch")) {
    try {
      const container = await waitForElement(videoPageSelectors, 10000);
      insertIcon(data, container, settings);
    } catch {}
  }
}

// ====================== Home/feed cards ======================

async function processHomeCard(card) {
  if (card.dataset.peCheckerDone || card.dataset.peCheckerPending) return;
  const link =
    card.querySelector('a[href*="/channel/"]') ||
    card.querySelector('a[href^="/@"]');
  if (!link) return;

  card.dataset.peCheckerPending = "1";

  let channelId = null;
  const href = link.getAttribute("href") || "";
  if (href.startsWith("/channel/")) {
    channelId = href.split("/channel/")[1];
  } else if (href.startsWith("/@")) {
    channelId = await resolveHandleToChannelId(href);
  }

  if (!channelId) {
    delete card.dataset.peCheckerPending;
    return;
  }

  const settings = await getSettings();
  const data = await fetchChannelData(channelId);
  data.id = channelId; // store for voting

  const channelNameEl =
    card.querySelector(
      ".yt-content-metadata-view-model-wiz__metadata-row a[href^='/@']"
    ) ||
    card.querySelector(
      ".yt-content-metadata-view-model-wiz__metadata-row a[href*='/channel/']"
    );

  let container = null;
  if (channelNameEl) {
    container = channelNameEl.parentElement || channelNameEl;
  } else {
    container = card.querySelector(
      ".yt-content-metadata-view-model-wiz__metadata-row"
    );
  }

  if (container) {
    insertIcon(data, container, settings);
    card.dataset.peCheckerDone = "1";
  }

  delete card.dataset.peCheckerPending;
}

function checkHomePageVideos() {
  const cards = document.querySelectorAll("ytd-rich-item-renderer");
  cards.forEach((card) => {
    processHomeCard(card);
  });
}

// ====================== Watch-next sidebar ======================

async function processWatchNextCard(card) {
  if (card.dataset.peCheckerDone || card.dataset.peCheckerPending) return;

  card.dataset.peCheckerPending = "1";

  const channelLink =
    card.querySelector('a[href*="/channel/"]') ||
    card.querySelector('a[href^="/@"]');

  let channelId = null;
  if (channelLink) {
    const href = channelLink.getAttribute("href") || "";
    if (href.startsWith("/channel/")) {
      channelId = href.split("/channel/")[1];
    } else if (href.startsWith("/@")) {
      channelId = await resolveHandleToChannelId(href);
    }
  }

  if (!channelId) {
    const innerWithId = card.querySelector("[class*='content-id-']");
    if (innerWithId) {
      const cidClass =
        Array.from(innerWithId.classList).find((c) =>
          c.startsWith("content-id-")
        ) || "";
      const videoId = cidClass.replace("content-id-", "");
      if (videoId && videoId.length === 11) {
        channelId = await resolveVideoIdToChannelId(videoId);
      }
    }
  }

  if (!channelId) {
    delete card.dataset.peCheckerPending;
    return;
  }

  const settings = await getSettings();
  const data = await fetchChannelData(channelId);
  data.id = channelId; // store for voting

  const container =
    card.querySelector(
      ".yt-content-metadata-view-model-wiz__metadata-row"
    ) || card;

  insertIcon(data, container, settings);
  card.dataset.peCheckerDone = "1";
  delete card.dataset.peCheckerPending;
}

function checkWatchNextSidebar() {
  const cards = document.querySelectorAll(
    "ytd-watch-next-secondary-results-renderer yt-lockup-view-model"
  );
  cards.forEach((card) => {
    processWatchNextCard(card);
  });
}

// ====================== Bootstrapping ======================

window.addEventListener("load", () => {
  setTimeout(() => {
    checkChannel();

    if (location.pathname === "/" || location.pathname.startsWith("/feed")) {
      checkHomePageVideos();
    }

    if (location.pathname.startsWith("/watch")) {
      checkWatchNextSidebar();
    }
  }, 500);
});

const observer = new MutationObserver(() => {
  debounceCheckChannel();

  if (location.pathname === "/" || location.pathname.startsWith("/feed")) {
    checkHomePageVideos();
  }

  if (location.pathname.startsWith("/watch")) {
    checkWatchNextSidebar();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// Ensure we keep minimal state if SPA tears down
window.addEventListener("pagehide", () => {
  settingsCache =
    settingsCache || ({ reduceMotion: false, violenceLevel: 1.0 });
});