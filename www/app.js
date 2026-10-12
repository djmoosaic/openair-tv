(() => {
  "use strict";

  const CFG = Object.assign({
    appName: "OpenAir TV",
    playlists: ["https://iptv-org.github.io/iptv/index.m3u"],
    featuredCategories: [],
    hiddenCategories: ["XXX"],
    hiddenChannels: [],
    androidAppUrl: "",
    hideGeoBlocked: false,
    loadTimeout: 15000,
  }, window.APP_CONFIG || {});

  const $ = (id) => document.getElementById(id);
  const el = {
    app: $("app"), list: $("list"), chips: $("chips"), search: $("search"), count: $("count"),
    video: $("video"), welcome: $("welcome"), spinner: $("spinner"), error: $("error"),
    errorText: $("errorText"), retryBtn: $("retryBtn"), nowName: $("nowName"), nowLogo: $("nowLogo"),
    favBtn: $("favBtn"), menuBtn: $("menuBtn"), details: $("details"), badges: $("badges"), alt: $("alt"),
    brandName: $("brandName"),
  };

  // Inside the Android / Fire TV app, play video with Android's native player (hardware decoding)
  const NativePlayer = (() => {
    const C = window.Capacitor;
    try {
      if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
      return C.registerPlugin ? C.registerPlugin("NativePlayer") : (C.Plugins && C.Plugins.NativePlayer) || null;
    } catch { return null; }
  })();
  let nativeBroken = false;

  const PAGE = 120;          // rows rendered per batch
  const FAV_KEY = "openair.favourites";
  const LAST_KEY = "openair.last";
  const isSecurePage = location.protocol === "https:";

  const state = {
    channels: [],            // [{id, name, logo, categories, streams:[{url, quality, flags}]}]
    byId: new Map(),
    filtered: [],
    rendered: 0,
    category: "All",
    query: "",
    current: null,
    streamIndex: 0,
    triedFallback: false,
    hls: null,
    timer: null,
    favs: new Set(readJSON(FAV_KEY, [])),
  };

  // ───────────────── helpers ─────────────────
  function readJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }
  function make(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "TV";
  }

  // ───────────────── M3U parsing ─────────────────
  function parseM3U(text) {
    const out = [];
    const lines = text.split(/\r?\n/);
    let info = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#EXTINF")) {
        const attrs = {};
        line.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; });
        const lastQuote = line.lastIndexOf('"');
        const comma = line.indexOf(",", lastQuote > -1 ? lastQuote : 0);
        const title = comma > -1 ? line.slice(comma + 1).trim() : "Unknown";
        info = { attrs, title };
      } else if (line.startsWith("#")) {
        continue;
      } else if (info) {
        out.push(toEntry(info, line));
        info = null;
      }
    }
    return out;
  }

  function toEntry({ attrs, title }, url) {
    const quality = (title.match(/\((\d{3,4}p)\)/) || [])[1] || "";
    const flags = [...title.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const name = title.replace(/\(\d{3,4}p\)/g, "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim() || title;
    let categories = (attrs["group-title"] || "")
      .split(";").map((c) => c.trim()).filter((c) => c && c !== "Undefined");
    if (!categories.length) categories = ["Other"];
    return {
      id: attrs["tvg-id"] || slug(name),
      name,
      logo: attrs["tvg-logo"] || "",
      categories,
      stream: { url, quality, flags },
    };
  }

  function buildChannels(entries) {
    const hidden = new Set(CFG.hiddenCategories.map((c) => c.toLowerCase()));
    const blocked = new Set(CFG.hiddenChannels.map((c) => c.toLowerCase()));
    const map = new Map();
    for (const e of entries) {
      if (e.categories.some((c) => hidden.has(c.toLowerCase()))) continue;
      if (blocked.has(e.name.toLowerCase()) || blocked.has(e.id.toLowerCase())) continue;
      if (CFG.hideGeoBlocked && e.stream.flags.some((f) => /geo/i.test(f))) continue;
      let ch = map.get(e.id);
      if (!ch) {
        ch = { id: e.id, name: e.name, logo: e.logo, categories: e.categories, streams: [] };
        map.set(e.id, ch);
      }
      if (!ch.logo && e.logo) ch.logo = e.logo;
      if (!ch.streams.some((s) => s.url === e.stream.url)) ch.streams.push(e.stream);
    }
    const list = [...map.values()];
    for (const ch of list) {
      // Best streams first: https (works everywhere), always-on, then higher resolution
      ch.streams.sort((a, b) => score(b) - score(a));
    }
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return list;
  }
  function score(s) {
    let n = parseInt(s.quality, 10) || 0;
    if (s.url.startsWith("https:")) n += 10000;
    if (!s.flags.length) n += 5000;
    return n;
  }

  // ───────────────── loading ─────────────────
  async function load() {
    el.list.replaceChildren(make("li", "empty", "Loading channels…"));
    try {
      const texts = await Promise.all(CFG.playlists.map(async (u) => {
        const r = await fetch(u, { cache: "default" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      }));
      state.channels = buildChannels(texts.flatMap(parseM3U));
      state.byId = new Map(state.channels.map((c) => [c.id, c]));
      renderChips();
      applyFilter();
    } catch (err) {
      el.count.textContent = "Couldn't load channels";
      const li = make("li", "empty");
      li.append(make("div", null, "Check your internet connection and try again."));
      const b = make("button", "pill", "Retry");
      b.onclick = load;
      li.append(b);
      el.list.replaceChildren(li);
      console.error(err);
      return;
    }
    try { restoreFromUrl(); } catch (err) { console.warn(err); show("welcome"); }
  }

  // ───────────────── categories ─────────────────
  // ───────────────── category row scrolling ─────────────────
  const chipsLeft = $("chipsLeft"), chipsRight = $("chipsRight");
  function updateChipArrows() {
    const c = el.chips;
    const max = c.scrollWidth - c.clientWidth;
    chipsLeft.classList.toggle("show", c.scrollLeft > 4);
    chipsRight.classList.toggle("show", c.scrollLeft < max - 4);
  }
  function scrollChips(dir) { el.chips.scrollBy({ left: dir * el.chips.clientWidth * 0.7, behavior: "smooth" }); }
  chipsLeft.onclick = () => scrollChips(-1);
  chipsRight.onclick = () => scrollChips(1);
  el.chips.addEventListener("scroll", updateChipArrows, { passive: true });
  window.addEventListener("resize", updateChipArrows);
  // Mouse wheel scrolls the row sideways
  el.chips.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const max = el.chips.scrollWidth - el.chips.clientWidth;
    if (max <= 0) return;
    e.preventDefault();
    el.chips.scrollLeft += e.deltaY;
  }, { passive: false });
  // Click-and-drag with the mouse
  let drag = null;
  el.chips.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag = { x: e.clientX, left: el.chips.scrollLeft, moved: false };
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 5) { drag.moved = true; el.chips.classList.add("dragging"); }
    if (drag.moved) el.chips.scrollLeft = drag.left - dx;
  });
  window.addEventListener("pointerup", () => {
    if (drag && drag.moved) setTimeout(() => el.chips.classList.remove("dragging"), 0);
    drag = null;
  });
  function revealChip(b) {
    const c = el.chips;
    const l = b.offsetLeft - c.offsetLeft, r = l + b.offsetWidth;
    if (l < c.scrollLeft + 30) c.scrollLeft = l - 40;
    else if (r > c.scrollLeft + c.clientWidth - 30) c.scrollLeft = r - c.clientWidth + 40;
  }

  function renderChips() {
    const counts = new Map();
    for (const ch of state.channels) for (const c of ch.categories) counts.set(c, (counts.get(c) || 0) + 1);
    const featured = CFG.featuredCategories.filter((c) => counts.has(c));
    const rest = [...counts.keys()].filter((c) => !featured.includes(c) && c !== "Other").sort();
    const cats = ["All", ...(state.favs.size ? ["★ Favourites"] : []), ...featured, ...rest];
    if (counts.has("Other")) cats.push("Other");
    if (!cats.includes(state.category)) state.category = "All";

    el.chips.replaceChildren(...cats.map((c) => {
      const b = make("button", "chip", c);
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(c === state.category));
      b.onclick = () => {
        state.category = c;
        for (const x of el.chips.children) x.setAttribute("aria-selected", String(x === b));
        revealChip(b);
        applyFilter();
        el.list.scrollTop = 0;
        syncUrl();
      };
      return b;
    }));
    requestAnimationFrame(updateChipArrows);
  }

  // ───────────────── list ─────────────────
  function applyFilter() {
    const q = state.query.toLowerCase();
    const cat = state.category;
    state.filtered = state.channels.filter((ch) => {
      if (cat === "★ Favourites" ? !state.favs.has(ch.id) : cat !== "All" && !ch.categories.includes(cat)) return false;
      return !q || ch.name.toLowerCase().includes(q) || ch.id.toLowerCase().includes(q);
    });
    el.count.textContent = `${state.filtered.length.toLocaleString()} channel${state.filtered.length === 1 ? "" : "s"}`;
    state.rendered = 0;
    el.list.replaceChildren();
    if (!state.filtered.length) {
      el.list.append(make("li", "empty", q ? `No channels match “${state.query}”.` : "Nothing here yet."));
      return;
    }
    renderMore();
  }

  const sentinel = make("li");
  sentinel.style.height = "1px";
  const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) renderMore(); }, { root: el.list, rootMargin: "400px" });

  function renderMore() {
    const end = Math.min(state.rendered + PAGE, state.filtered.length);
    const frag = document.createDocumentFragment();
    for (let i = state.rendered; i < end; i++) frag.append(row(state.filtered[i]));
    state.rendered = end;
    sentinel.remove();
    el.list.append(frag);
    if (end < state.filtered.length) { el.list.append(sentinel); io.observe(sentinel); }
  }

  function logoNode(ch) {
    const box = make("span", "logo");
    if (ch.logo) {
      const img = new Image();
      img.loading = "lazy";
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = ch.logo;
      img.onerror = () => box.replaceChildren(initials(ch.name));
      box.append(img);
    } else {
      box.textContent = initials(ch.name);
    }
    return box;
  }

  function row(ch) {
    const li = make("li");
    const b = make("button", "ch");
    b.dataset.id = ch.id;
    if (state.current && state.current.id === ch.id) b.classList.add("active");
    const text = make("span", "ch-text");
    text.append(make("span", "ch-name", ch.name));
    const s = ch.streams[0];
    const sub = [ch.categories.join(", ")];
    if (s.quality) sub.push(s.quality);
    if (s.flags.length) sub.push(s.flags.join(" · "));
    if (isSecurePage && ch.streams.every((x) => x.url.startsWith("http:"))) sub.push("App only");
    text.append(make("span", "ch-sub", sub.join(" · ")));
    b.append(logoNode(ch), text);
    if (state.favs.has(ch.id)) {
      b.insertAdjacentHTML("beforeend", '<svg class="star" viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>');
    }
    b.onclick = (ev) => {
      play(ch);
      // Keyboard / remote users (detail === 0): jump to the player so OK pauses, Left comes back
      if (!NativePlayer && ev.detail === 0 && matchMedia("(min-width: 861px)").matches) el.video.focus();
    };
    li.append(b);
    return li;
  }

  function markActive() {
    for (const b of el.list.querySelectorAll(".ch.active")) b.classList.remove("active");
    if (!state.current) return;
    const b = el.list.querySelector(`.ch[data-id="${CSS.escape(state.current.id)}"]`);
    if (b) b.classList.add("active");
  }

  // ───────────────── player ─────────────────
  function show(which) {
    el.welcome.hidden = which !== "welcome";
    el.spinner.hidden = which !== "loading";
    el.error.hidden = which !== "error";
  }

  function stop() {
    clearTimeout(state.timer);
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    el.video.removeAttribute("src");
    el.video.load();
  }

  function play(ch, index = 0, isFallback = false, autoStart = true) {
    stop();
    state.current = ch;
    state.streamIndex = index;
    if (!isFallback) state.triedFallback = false;
    const stream = ch.streams[index];

    el.nowName.textContent = ch.name + (stream.quality ? ` (${stream.quality})` : "");
    el.nowLogo.hidden = !ch.logo;
    if (ch.logo) el.nowLogo.src = ch.logo;
    el.favBtn.hidden = false;
    updateFavBtn();
    renderDetails();
    markActive();
    syncUrl();
    writeJSON(LAST_KEY, ch.id);
    document.title = `${ch.name} · ${CFG.appName}`;

    if (NativePlayer && !nativeBroken) {
      setWelcome("Press OK to watch " + ch.name, "Plays full screen. Press Back on your remote to return to the channel list.");
      show("welcome");
      if (!autoStart) return;
      const ordered = ch.streams.slice(index).concat(ch.streams.slice(0, index)).map((s) => s.url);
      NativePlayer.play({ urls: ordered, title: ch.name }).catch(() => {
        nativeBroken = true; // native player unavailable: fall back to the web player
        play(ch, index, isFallback, true);
      });
      return;
    }

    if (isSecurePage && stream.url.startsWith("http:")) {
      return fail("This channel uses an insecure (http) link, which browsers block on secure websites. It plays in the Android app.");
    }

    show("loading");
    state.timer = setTimeout(() => fail("The stream took too long to respond."), CFG.loadTimeout);

    const v = el.video;
    const isHls = /\.m3u8(\?|$)/i.test(stream.url) || !/\.(mp4|webm|mp3|aac)(\?|$)/i.test(stream.url);
    if (isHls && window.Hls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, manifestLoadingTimeOut: 12000 });
      state.hls = hls;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !hls._recovered) { hls._recovered = true; hls.recoverMediaError(); return; }
        fail();
      });
      hls.loadSource(stream.url);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => tryPlay());
    } else {
      v.src = stream.url;
      tryPlay();
    }
  }

  function setWelcome(title, text) {
    const h = el.welcome.querySelector("h1"), p = el.welcome.querySelector("p");
    if (h) h.textContent = title;
    if (p) p.textContent = text;
  }

  function tryPlay() {
    el.video.play().catch((err) => {
      // Autoplay blocked: not an error, the user can press play
      if (err && err.name === "NotAllowedError") { clearTimeout(state.timer); show(null); }
    });
  }

  function fail(message) {
    clearTimeout(state.timer);
    const ch = state.current;
    if (!ch) return;
    // Silently try the next source once if this channel has more than one
    const next = state.streamIndex + 1;
    if (!message && !state.triedFallback && next < ch.streams.length) {
      state.triedFallback = true;
      return play(ch, next, true);
    }
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    el.errorText.textContent = message || "It may be offline, geo-blocked, or not allow playback here. Try another source or channel.";
    show("error");
  }

  el.video.addEventListener("playing", () => { clearTimeout(state.timer); show(null); });
  el.video.addEventListener("waiting", () => { if (state.current && el.error.hidden) el.spinner.hidden = false; });
  el.video.addEventListener("error", () => { if (state.current && !state.hls && el.video.getAttribute("src")) fail(); });
  el.retryBtn.onclick = () => state.current && play(state.current, state.streamIndex);

  function renderDetails() {
    const ch = state.current;
    const s = ch.streams[state.streamIndex];
    const badges = [...ch.categories, s.quality, ...s.flags].filter(Boolean);
    el.badges.replaceChildren(...badges.map((b) => make("span", "badge", b)));
    el.alt.replaceChildren();
    if (ch.streams.length > 1) {
      el.alt.append(make("span", "label", "Sources:"));
      ch.streams.forEach((st, i) => {
        const b = make("button", "pill" + (i === state.streamIndex ? " on" : ""), `${i + 1}${st.quality ? " · " + st.quality : ""}`);
        b.onclick = () => play(ch, i);
        el.alt.append(b);
      });
    }
    el.details.hidden = false;
  }

  // ───────────────── favourites ─────────────────
  function updateFavBtn() {
    const on = state.current && state.favs.has(state.current.id);
    el.favBtn.classList.toggle("on", !!on);
    el.favBtn.setAttribute("aria-label", on ? "Remove from favourites" : "Add to favourites");
  }
  el.favBtn.onclick = () => {
    const id = state.current.id;
    state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
    writeJSON(FAV_KEY, [...state.favs]);
    updateFavBtn();
    renderChips();
    applyFilter();
    markActive();
  };

  // ───────────────── URL & UI wiring ─────────────────
  function syncUrl() {
    const p = new URLSearchParams();
    if (state.category !== "All") p.set("category", state.category);
    if (state.current) p.set("channel", state.current.id);
    const qs = p.toString();
    try { history.replaceState(null, "", qs ? `?${qs}` : location.pathname); } catch { /* not allowed for local files in some browsers */ }
  }

  function restoreFromUrl() {
    const p = new URLSearchParams(location.search);
    const cat = p.get("category");
    if (cat) {
      const match = [...el.chips.children].find((c) => c.textContent.toLowerCase() === cat.toLowerCase());
      if (match) match.click();
    }
    const id = p.get("channel") || readJSON(LAST_KEY, null);
    const ch = id && state.byId.get(id);
    if (ch) {
      play(ch, 0, false, !NativePlayer); // in the app, don't jump straight into full screen on launch
      const b = el.list.querySelector(`.ch[data-id="${CSS.escape(ch.id)}"]`);
      if (b && b.scrollIntoView) b.scrollIntoView({ block: "center" });
    } else {
      show("welcome");
    }
  }

  let searchTimer;
  el.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = el.search.value.trim();
      // Searching always looks through every channel
      if (state.query && state.category !== "All") {
        state.category = "All";
        for (const x of el.chips.children) x.setAttribute("aria-selected", String(x.textContent === "All"));
        el.chips.scrollLeft = 0;
        syncUrl();
      }
      applyFilter();
      el.list.scrollTop = 0;
    }, 150);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== el.search) { e.preventDefault(); el.search.focus(); }
  });
  el.menuBtn.onclick = () => el.app.classList.toggle("collapsed");

  // TV remotes: after picking a channel, move focus to the player; OK toggles play/pause.
  el.video.tabIndex = NativePlayer ? -1 : 0; // in the app, video plays in the native player instead
  el.video.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "MediaPlayPause") {
      e.preventDefault();
      el.video.paused ? el.video.play().catch(() => {}) : el.video.pause();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      const active = el.list.querySelector(".ch.active") || el.list.querySelector(".ch");
      if (active) { e.preventDefault(); active.focus(); }
    }
  });

  el.brandName.textContent = CFG.appName;
  document.title = `${CFG.appName} · Free Live TV`;

  // ───────────────── install app / Android download ─────────────────
  const isNativeApp = !!window.Capacitor;
  const installBtn = $("installBtn"), apkBtn = $("apkBtn");
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    installBtn.hidden = true;
  };
  window.addEventListener("appinstalled", () => { installBtn.hidden = true; });
  if (CFG.androidAppUrl && !isNativeApp) {
    apkBtn.href = CFG.androidAppUrl;
    apkBtn.hidden = false;
  }
  // Offline-ready shell on the real website only (not in the Android app or local files)
  if ("serviceWorker" in navigator && location.protocol === "https:" && !isNativeApp) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  // ───────────────── TV remote (D-pad) navigation ─────────────────
  // Fire TV / Android TV: arrow keys move to the nearest item in that direction.
  const isTV = !!NativePlayer || /AFT|Android TV|GoogleTV|BRAVIA|SMART-TV|SmartTV|Tizen|Web0S|Silk/i.test(navigator.userAgent);
  const FOCUSABLE = "button:not([hidden]):not([disabled]), a[href], input, video[tabindex]";

  function visibleTarget(n) {
    if (n.hidden || n.closest("[hidden]") || n.tabIndex < 0) return false;
    const r = n.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    // Must sit inside the screen area vertically/horizontally of its scroll area (items just off-edge are fine)
    return getComputedStyle(n).visibility !== "hidden";
  }

  function moveFocus(dir) {
    const cur = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const all = [...document.querySelectorAll(FOCUSABLE)].filter((n) => n !== cur && visibleTarget(n));
    if (!cur) { const first = el.list.querySelector(".ch.active") || el.list.querySelector(".ch") || all[0]; if (first) focusEl(first); return; }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const n of all) {
      const b = n.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      let main, cross;
      if (dir === "ArrowRight") { if (bx <= ax + 4) continue; main = Math.max(0, b.left - a.right); cross = Math.abs(by - ay); }
      else if (dir === "ArrowLeft") { if (bx >= ax - 4) continue; main = Math.max(0, a.left - b.right); cross = Math.abs(by - ay); }
      else if (dir === "ArrowDown") { if (by <= ay + 4) continue; main = Math.max(0, b.top - a.bottom); cross = Math.abs(bx - ax); }
      else { if (by >= ay - 4) continue; main = Math.max(0, a.top - b.bottom); cross = Math.abs(bx - ax); }
      // Prefer items in the same row/column: overlap on the cross axis counts as perfectly aligned
      const overlap = (dir === "ArrowLeft" || dir === "ArrowRight")
        ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        : Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (overlap > 0) cross = 0;
      // Left/Right only move along the same row (so Right from the channel list doesn't jump up to the categories)
      if ((dir === "ArrowLeft" || dir === "ArrowRight") && overlap <= 0 && cross > a.height) continue;
      const score = main + cross * 3;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (best) focusEl(best);
  }

  function focusEl(n) {
    n.focus({ preventScroll: true });
    n.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (n.classList.contains("chip")) updateChipArrows();
  }

  if (isTV) {
    document.documentElement.classList.add("tv");
    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented || !/^Arrow/.test(e.key)) return;
      const t = document.activeElement;
      // In the search box, Left/Right move the cursor until it reaches the start/end of the text
      if (t === el.search) {
        const atStart = t.selectionStart === 0 && t.selectionEnd === 0;
        const atEnd = t.selectionStart === t.value.length;
        if ((e.key === "ArrowLeft" && !atStart) || (e.key === "ArrowRight" && !atEnd)) return;
      }
      e.preventDefault();
      moveFocus(e.key);
    });
    // OK / Enter on the search box after typing: show results and jump to the first channel
    el.search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        el.search.dispatchEvent(new Event("input"));
        setTimeout(() => {
          const first = el.list.querySelector(".ch");
          if (first) focusEl(first); // otherwise stay in the search box ("No channels match")
        }, 200);
      }
    });
    // Start with the remote on the channel list
    const waitForList = setInterval(() => {
      const first = el.list.querySelector(".ch.active") || el.list.querySelector(".ch");
      if (first) { clearInterval(waitForList); if (!document.activeElement || document.activeElement === document.body) focusEl(first); }
    }, 300);
    setTimeout(() => clearInterval(waitForList), 20000);
  }

  // Expose for tests / debugging
  window.OpenAirTV = { parseM3U, buildChannels, state };

  load();
})();
