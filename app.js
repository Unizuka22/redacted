/* Redacted — launch on pump.fun, hold on Monero. Real wallets, real chain reads, real PumpPortal trades.
 * Needs: solanaWeb3 (CDN), config.js, wallet.js, pump.js.
 */
(() => {
  "use strict";
  const C = window.REDACTED_CONFIG, W = window.RedactedWallet, P = window.RedactedPump;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const now = () => Date.now();
  const short = (s) => (s ? s.slice(0, 4) + "…" + s.slice(-4) : "");
  const fmtN = (x, d = 4) => (Math.abs(x) >= 1000 ? x.toLocaleString("en-US", { maximumFractionDigits: 1 }) : x.toFixed(d));
  const fmtT = (n) => { const a = Math.abs(n); if (a >= 1e9) return (n / 1e9).toFixed(2) + "B"; if (a >= 1e6) return (n / 1e6).toFixed(2) + "M"; if (a >= 1e3) return (n / 1e3).toFixed(1) + "K"; return n.toFixed(0); };
  const fmtUsd = (x) => "$" + Math.round(x).toLocaleString("en-US");
  const fmtP = (p) => (p < 1e-6 ? p.toExponential(2) : p.toFixed(8));
  const pct = (x) => (x * 100).toFixed(x >= 0.1 ? 1 : 2) + "%";
  const ago = (t) => { const s = Math.max(1, (now() - t) / 1000); if (s < 60) return Math.floor(s) + "s"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h"; return Math.floor(s / 86400) + "d"; };
  const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; } };
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const b58 = (n) => Array.from({ length: n }, () => B58[Math.floor(Math.random() * 58)]).join("");

  // ---------------- registry (which mints this launchpad shows) ----------------
  const KEY = "redacted.registry.v1";
  let S = { coins: [], holderKey: "rk1" + b58(40), v: 1 };
  function load() { try { const r = localStorage.getItem(KEY); if (r) { const s = JSON.parse(r); if (s && Array.isArray(s.coins)) S = s; } } catch { /* fresh */ } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignore */ } }
  function upsert(c) { const i = S.coins.findIndex((x) => x.mint === c.mint); if (i >= 0) S.coins[i] = { ...S.coins[i], ...c }; else S.coins.unshift(c); save(); }
  async function syncRegistry() {
    if (!C.api.coins) return;
    try { const r = await fetch(C.api.coins, { cache: "no-store" }); const list = await r.json(); if (Array.isArray(list)) { list.forEach((c) => c.mint && upsert({ mint: c.mint, name: c.name, symbol: c.symbol, image: c.image, description: c.description, createdAt: c.createdAt ? +new Date(c.createdAt) : undefined, creator: c.creator, links: c.links })); renderAll(); } } catch (e) { console.warn("coins api", e); }
  }

  // ---------------- live chain cache ----------------
  const LIVE = {};              // mint -> { curve, meta, holders, bal, hist: [{t,p}], at }
  const USD = { sol: null, xmr: null };
  const VIEW = { tab: "trending", q: "", side: "buy", amt: "", bamt: "", busy: false };
  const live = (m) => LIVE[m] || (LIVE[m] = { curve: null, meta: null, dex: null, holders: [], bal: 0, sol: 0, hist: [], at: 0, err: null });

  async function refreshCurve(mint) {
    const L = live(mint);
    try { const cv = await P.curve(mint); L.curve = cv; L.err = cv ? null : "No pump.fun curve found for this mint."; if (cv) { L.hist.push({ t: now(), p: cv.price }); if (L.hist.length > 300) L.hist.shift(); } L.at = now(); }
    catch (e) { L.err = "RPC: " + (e.message || e); }
    return L;
  }
  async function refreshMeta(mint) {
    const L = live(mint); if (L.meta) return L;
    try { const m = await P.metadata(mint); if (m) { L.meta = m; upsert({ mint, name: m.name, symbol: m.symbol, image: m.image, description: m.description, links: m.links }); } } catch (e) { console.warn("meta", e); }
    return L;
  }
  async function refreshDex(mint) {
    const L = live(mint);
    try { const d = await P.dex(mint); L.dex = d; if (d) { const c = S.coins.find((x) => x.mint === mint) || {}; upsert({ mint, name: c.name || d.name, symbol: c.symbol || d.symbol, image: c.image || d.image, createdAt: c.createdAt && c.createdAt < (d.created || Infinity) ? c.createdAt : (d.created || c.createdAt) }); } }
    catch (e) { console.warn("dex", e); }
    return L;
  }
  async function refreshCoin(mint) {
    const L = live(mint);
    await Promise.all([refreshCurve(mint), refreshMeta(mint), refreshDex(mint)]);
    if (W.publicKey) { try { L.bal = await P.balance(W.publicKey, mint); } catch { /* keep */ } }
    // holders are heavy on public RPCs: load after the page is up, never block on them
    P.holders(mint).then((h) => { L.holders = h; L.holdersErr = null; if (current === mint) renderCoin(mint); }).catch((e) => { L.holdersErr = "holders unavailable on this RPC"; if (current === mint) renderCoin(mint); });
    return L;
  }
  async function refreshBoard() {
    await Promise.all(S.coins.slice(0, 40).map((c) => Promise.all([refreshDex(c.mint), refreshCurve(c.mint)]).then(() => refreshMeta(c.mint))));
    renderStats(); renderFeatured();
  }
  function renderFeatured() {
    const g = $("featured-grid"); if (!g) return; g.innerHTML = "";
    const list = S.coins.filter((c) => c.featured);
    $("featured").hidden = !list.length;
    list.forEach((c) => g.appendChild(card(c)));
  }

  // local quote on the curve, same math pump.fun runs
  function quoteBuy(cv, sol) { const fee = sol * 0.01, net = sol - fee, k = cv.vSol * cv.vTok; const tokens = Math.min(cv.rTok, cv.vTok - k / (cv.vSol + net)); return { fee, tokens, impact: tokens > 0 ? (net / tokens) / cv.price - 1 : 0 }; }
  function quoteSell(cv, tokens) { const k = cv.vSol * cv.vTok; const gross = cv.vSol - k / (cv.vTok + tokens); const fee = gross * 0.01; return { fee, solOut: gross - fee, impact: tokens > 0 ? 1 - (gross / tokens) / cv.price : 0 }; }

  // ---------------- toasts ----------------
  function toast(msg, err = false, ms = 3600) {
    const t = el("div", "toast" + (err ? " err" : ""), msg); $("toasts").appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .4s"; setTimeout(() => t.remove(), 450); }, ms);
    return t;
  }
  const errMsg = (e) => (e && e.message ? e.message : String(e)).replace(/^Error:\s*/, "").slice(0, 180);

  function avatar(c, cls = "avatar") {
    const a = el(cls === "avatar" ? "div" : "div", cls);
    const img = c.image || (c.meta && c.meta.image);
    if (img) { const im = el("img"); im.src = img; im.alt = ""; im.loading = "lazy"; im.onerror = () => { im.remove(); a.textContent = (c.name || "?").slice(0, 1).toUpperCase(); }; a.appendChild(im); }
    else a.textContent = (c.name || "?").slice(0, 1).toUpperCase();
    return a;
  }

  // ---------------- header: wallet ----------------
  function renderHeader() {
    const b = $("connect"), l = $("connect-label");
    if (W.publicKey) { b.classList.add("on"); const L = LIVE.__wallet || {}; l.textContent = short(W.publicKey) + (L.sol != null ? " · " + L.sol.toFixed(3) + " SOL" : ""); }
    else { b.classList.remove("on"); l.textContent = "Connect wallet"; }
  }
  async function refreshWallet() { if (!W.publicKey) return; try { (LIVE.__wallet = LIVE.__wallet || {}).sol = await P.solBalance(W.publicKey); } catch { /* ignore */ } renderHeader(); }
  function openWallet() {
    const b = $("wm-body"); b.innerHTML = "";
    if (W.publicKey) {
      $("wm-title").textContent = "Wallet"; $("wm-sub").textContent = "Connected with " + W.name + ".";
      b.appendChild(el("div", "pm-addr", W.publicKey));
      const L = LIVE.__wallet || {}; const bal = el("div", "pm-bal"); bal.appendChild(el("b", "", L.sol != null ? L.sol.toFixed(3) : "…")); bal.appendChild(el("span", "", "SOL" + (USD.sol && L.sol != null ? " · " + fmtUsd(L.sol * USD.sol) : ""))); b.appendChild(bal);
      b.appendChild(el("div", "pm-addr", "monero holder key  " + S.holderKey));
      const foot = el("div", "pm-foot"); const d = el("button", "pm-reset", "Disconnect"); d.type = "button"; d.onclick = async () => { await W.disconnect(); closeWallet(); }; foot.appendChild(el("small", "", W.name)); foot.appendChild(d); b.appendChild(foot);
    } else {
      $("wm-title").textContent = "Connect wallet"; $("wm-sub").textContent = "Pick a Solana wallet. Redacted never sees your keys; every transaction is signed in the wallet.";
      const rows = el("div", "wallets");
      W.detect().forEach((e) => {
        const r = e.provider ? el("button") : el("a"); r.type = "button";
        const ic = el("img", "wimg"); ic.src = e.icon; ic.alt = ""; ic.width = 30; ic.height = 30; r.appendChild(ic); r.append(e.name);
        if (e.provider) { r.appendChild(el("small", "", "detected")); r.classList.add("det"); r.onclick = async () => { try { await W.connect(e); closeWallet(); toast("Connected " + e.name + " · " + short(W.publicKey)); refreshWallet(); refreshCurrent(); } catch (er) { toast(errMsg(er), true); } }; }
        else { r.appendChild(el("small", "", "install")); if (e.url) { r.href = e.url; r.target = "_blank"; r.rel = "noopener"; } }
        rows.appendChild(r);
      });
      b.appendChild(rows);
    }
    $("wallet-modal").hidden = false;
  }
  function closeWallet() { $("wallet-modal").hidden = true; }

  // ---------------- pulses ----------------
  async function fetchHeight() {
    const show = (h) => { $("height").textContent = "height " + Number(h).toLocaleString("en-US"); };
    const tries = [
      async () => { const r = await fetch("https://xmrchain.net/api/networkinfo", { cache: "no-store" }); return (await r.json()).data.height; },
      async () => { const r = await fetch("https://api.blockchair.com/monero/stats", { cache: "no-store" }); return (await r.json()).data.blocks; },
    ];
    for (const t of tries) { try { const h = await t(); if (h > 1000) { show(h); return; } } catch { /* next */ } }
    show(3_742_000 + Math.floor((now() - Date.UTC(2026, 9, 9)) / 120000)); $("pulse").title = "Estimated height (no explorer reachable)";
  }
  async function fetchUsd() { try { const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana,monero&vs_currencies=usd"); const j = await r.json(); USD.sol = j.solana && j.solana.usd; USD.xmr = j.monero && j.monero.usd; renderAll(); } catch { /* fine */ } }

  // ---------------- left column ----------------
  function renderStats() {
    const cvs = S.coins.map((c) => live(c.mint).curve).filter(Boolean);
    if ($("st-coins")) {
      $("st-coins").textContent = S.coins.length;
      $("st-sol").textContent = cvs.filter((c) => !c.complete).reduce((a, c) => a + c.rSol, 0).toFixed(1);
      $("st-grad").textContent = cvs.filter((c) => c.complete).length;
    }
    const miss = [];
    if (!C.launchpadWallet) miss.push("launchpadWallet");
    if (C.createMode === "backend" && !C.api.launch) miss.push("api.launch");
    if (miss.length && !renderStats.warned) { renderStats.warned = true; console.warn("Redacted config missing: " + miss.join(", ") + " (config.js)"); }
  }

  let pendingFile = null, pendingImg = null;
  function bindCreate() {
    const form = $("create-form"), err = $("c-err"), prev = $("c-preview"), btn = $("c-launch");
    if (!form) return;
    const updatePreview = () => { if (pendingImg) return; const n = $("c-name").value.trim(); prev.textContent = n ? n.slice(0, 1).toUpperCase() : "?"; };
    $("c-ticker").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10); updatePreview(); });
    $("c-name").addEventListener("input", updatePreview);
    $("c-img").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      if (f.size > 4 * 1024 * 1024) { err.textContent = "Image is over 4 MB."; e.target.value = ""; return; }
      pendingFile = f; const rd = new FileReader();
      rd.onload = () => { pendingImg = rd.result; prev.innerHTML = ""; const im = el("img"); im.src = pendingImg; im.alt = ""; prev.appendChild(im); $("c-img-hint").textContent = f.name; err.textContent = ""; };
      rd.readAsDataURL(f);
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); err.textContent = "";
      const name = $("c-name").value.trim(), symbol = $("c-ticker").value.trim(), description = $("c-desc").value.trim();
      const devBuy = parseFloat($("c-buy").value) || 0;
      if (name.length < 2) return (err.textContent = "Name needs at least 2 characters.");
      if (symbol.length < 2) return (err.textContent = "Ticker needs 2 to 10 letters or digits.");
      if (!pendingFile) return (err.textContent = "pump.fun needs an image.");
      if (!W.publicKey) { openWallet(); return (err.textContent = "Connect a wallet to launch."); }
      const links = { website: safeUrl($("c-web").value.trim()), twitter: safeUrl($("c-x").value.trim()), telegram: safeUrl($("c-tg").value.trim()) };
      btn.disabled = true; VIEW.busy = true;
      try {
        let mint, signature;
        if (C.createMode === "wallet") {
          toast("Uploading metadata to pump.fun…", false, 6000);
          const r = await P.createWithWallet({ wallet: W, form: { file: pendingFile, name, symbol, description, ...links }, devBuySol: devBuy });
          mint = r.mint; signature = r.signature;
          toast("Created on pump.fun. Note: in wallet mode the creator is your wallet, so creator fees go to you, not the launchpad.", false, 7000);
        } else {
          if (!C.api.launch || !C.launchpadWallet) throw new Error("Backend launch is not configured. Set launchpadWallet and api.launch in config.js.");
          const total = devBuy + C.launchCostSol;
          toast(`Sign the transfer of ${total.toFixed(3)} SOL to the launchpad (${C.launchCostSol} SOL birth cost + ${devBuy} SOL dev buy)…`, false, 7000);
          const transferSig = await P.transferSol({ wallet: W, to: C.launchpadWallet, sol: total });
          toast("Transfer confirmed. Creating the coin from the launchpad wallet…", false, 6000);
          const fd = new FormData();
          fd.append("image", pendingFile); fd.append("name", name); fd.append("symbol", symbol); fd.append("description", description);
          fd.append("website", links.website); fd.append("twitter", links.twitter); fd.append("telegram", links.telegram);
          fd.append("devBuySol", String(devBuy)); fd.append("buyer", W.publicKey); fd.append("transferSig", transferSig); fd.append("holderKey", S.holderKey);
          const r = await fetch(C.api.launch, { method: "POST", body: fd });
          if (!r.ok) throw new Error("Launch backend " + r.status + ": " + (await r.text()).slice(0, 160));
          const j = await r.json(); if (!j.mint) throw new Error("Launch backend returned no mint."); mint = j.mint; signature = j.signature || transferSig;
        }
        upsert({ mint, name, symbol, image: pendingImg, description, links: { web: links.website, x: links.twitter, tg: links.telegram }, createdAt: now(), creator: C.createMode === "wallet" ? W.publicKey : C.launchpadWallet });
        form.reset(); pendingFile = null; pendingImg = null; prev.textContent = "?"; $("c-img-hint").textContent = "png / jpg / webp / gif · max 4 MB";
        toast(`$${symbol} is born on pump.fun. ${short(mint)}`);
        location.hash = "#/coin/" + mint; renderAll(); refreshWallet();
      } catch (er) { err.textContent = errMsg(er); toast(errMsg(er), true, 6000); }
      finally { btn.disabled = false; VIEW.busy = false; }
    });

    // track any existing pump.fun mint (only if the input exists)
    if ($("track-form")) $("track-form").addEventListener("submit", async (e) => {
      e.preventDefault(); const v = $("track").value.trim(); if (!v) return;
      if (!P.isPubkey(v)) return toast("That is not a Solana address.", true);
      const t = toast("Reading the curve…", false, 8000);
      const L = await refreshCurve(v); t.remove();
      if (!L.curve) return toast(L.err || "No pump.fun curve found.", true);
      await refreshMeta(v); upsert({ mint: v, name: L.meta && L.meta.name, symbol: L.meta && L.meta.symbol, image: L.meta && L.meta.image, description: L.meta && L.meta.description, createdAt: now() });
      $("track").value = ""; location.hash = "#/coin/" + v; renderAll();
    });
  }

  // ---------------- board ----------------
  function filtered() {
    const q = VIEW.q.toLowerCase();
    const cv = (c) => live(c.mint).curve;
    let list = S.coins.filter((c) => !q || (c.name || "").toLowerCase().includes(q) || (c.symbol || "").toLowerCase().includes(q) || c.mint.toLowerCase().includes(q));
    const isLive = (c) => !cv(c) || !cv(c).complete;
    switch (VIEW.tab) {
      case "new": list = list.filter(isLive).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); break;
      case "graduating": list = list.filter(isLive).sort((a, b) => ((cv(b) && cv(b).progress) || 0) - ((cv(a) && cv(a).progress) || 0)); break;
      case "graduated": list = list.filter((c) => cv(c) && cv(c).complete); break;
      default: list = list.filter(isLive).sort((a, b) => ((cv(b) && cv(b).mcap) || 0) - ((cv(a) && cv(a).mcap) || 0));
    }
    return list;
  }
  function card(c) {
    const cv = live(c.mint).curve, L = live(c.mint);
    const a = el("a", "card"); a.href = "#/coin/" + c.mint;
    a.appendChild(avatar(c));
    const b = el("div", "card-body");
    const nm = el("div", "card-name", c.name || short(c.mint)); nm.appendChild(el("small", "", c.symbol ? "$" + c.symbol : "")); b.appendChild(nm);
    const by = el("div", "card-by"); by.append(c.creator ? "by " : ""); if (c.creator) by.appendChild(el("b", "", c.creator === C.launchpadWallet ? "redacted" : c.creator === W.publicKey ? "you" : short(c.creator))); by.append((c.creator ? " · " : "") + (c.createdAt ? ago(c.createdAt) + " ago" : short(c.mint)) + (cv && cv.complete ? " · ascended" : "")); b.appendChild(by);
    if (c.description) b.appendChild(el("div", "card-desc", c.description));
    const f = el("div", "card-foot"); const d = L.dex;
    if (d && (!cv || cv.complete)) { f.appendChild(el("span", "mc", "mcap " + fmtUsd(d.mcap) + " · " + d.dex)); if (d.change24 != null) f.appendChild(el("span", "chg " + (d.change24 >= 0 ? "up" : "down"), (d.change24 >= 0 ? "+" : "") + d.change24.toFixed(1) + "% 24h")); }
    else if (cv && cv.complete && cv.vSol === 0) f.appendChild(el("span", "mc", "ascended · trades on PumpSwap"));
    else if (cv) { f.appendChild(el("span", "mc", "mcap " + fmtN(cv.mcap, 2) + " SOL" + (USD.sol ? " · " + fmtUsd(cv.mcap * USD.sol) : ""))); f.appendChild(el("span", "chg", pct(cv.progress))); }
    else f.appendChild(el("span", "", L.err ? L.err : "reading…"));
    b.appendChild(f);
    if (c.featured) b.appendChild(el("div", "card-by here", "✦ summoned here"));
    if (cv && !cv.complete) { const p = el("div", "prog"); const i = el("i"); i.style.width = (cv.progress * 100).toFixed(1) + "%"; p.appendChild(i); b.appendChild(p); }
    a.appendChild(b); return a;
  }
  function renderBoard() {
    const grid = $("board"); if (!grid) return; grid.innerHTML = "";
    const list = filtered();
    if (!list.length) {
      const e = el("div", "empty"); e.append(VIEW.q ? "Nothing matches that search." : "Nothing here yet. ");
      if (!VIEW.q) { const a = el("a", "", "Launch the first one"); a.href = "#create"; a.addEventListener("click", (ev) => { ev.preventDefault(); $("c-name").focus(); }); e.appendChild(a); e.append(" or paste a pump.fun mint above to summon it."); }
      grid.appendChild(e); return;
    }
    const g = el("div", "board-grid"); list.forEach((c) => g.appendChild(card(c))); grid.appendChild(g);
  }

  // ---------------- coin page ----------------
  function chart(L, symbol) {
    if (L.dex && L.dex.pair) {
      const box = el("div", "chart dex");
      const h = el("div", "chart-head"); h.appendChild(el("b", "", "$" + (L.dex.priceUsd < 0.001 ? L.dex.priceUsd.toPrecision(3) : L.dex.priceUsd.toFixed(4)))); h.appendChild(el("span", "", "per " + symbol + " · live from DexScreener · " + L.dex.dex)); box.appendChild(h);
      const f = el("iframe"); f.src = "https://dexscreener.com/solana/" + L.dex.pair + "?embed=1&theme=dark&trades=0&info=0"; f.title = symbol + " chart"; f.loading = "lazy"; f.allow = "clipboard-write"; box.appendChild(f);
      return box;
    }
    const box = el("div", "chart"); const cv = L.curve;
    const h = el("div", "chart-head"); h.appendChild(el("b", "", cv ? (cv.complete && cv.vSol === 0 ? "on PumpSwap" : fmtP(cv.price) + " SOL") : "…")); h.appendChild(el("span", "", "per " + symbol + " on pump.fun · live since you opened it")); box.appendChild(h);
    const pts = L.hist.length ? L.hist.slice(-160) : [{ t: now(), p: cv ? cv.price : 0 }];
    const W_ = 600, H = 190, pad = { l: 6, r: 56, t: 10, b: 18 };
    const ps = pts.map((x) => x.p); const min = Math.min(...ps), max = Math.max(...ps); const span = max - min || max * 0.1 || 1e-9;
    const x = (i) => pad.l + (i / Math.max(1, pts.length - 1)) * (W_ - pad.l - pad.r), y = (p) => pad.t + (1 - (p - min) / span) * (H - pad.t - pad.b);
    const ns = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", `0 0 ${W_} ${H}`); svg.setAttribute("preserveAspectRatio", "none");
    const defs = document.createElementNS(ns, "defs"); defs.innerHTML = `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6600" stop-opacity=".35"/><stop offset="1" stop-color="#ff6600" stop-opacity="0"/></linearGradient>`; svg.appendChild(defs);
    for (let i = 0; i <= 3; i++) { const gy = pad.t + (i / 3) * (H - pad.t - pad.b); const l = document.createElementNS(ns, "line"); l.setAttribute("x1", pad.l); l.setAttribute("x2", W_ - pad.r); l.setAttribute("y1", gy); l.setAttribute("y2", gy); l.setAttribute("class", "gd"); svg.appendChild(l); const t = document.createElementNS(ns, "text"); t.setAttribute("x", W_ - pad.r + 6); t.setAttribute("y", gy + 3); t.setAttribute("class", "lb"); t.textContent = fmtP(max - (i / 3) * span); svg.appendChild(t); }
    const d = pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.p).toFixed(1)).join(" ");
    const area = document.createElementNS(ns, "path"); area.setAttribute("d", d + ` L${x(pts.length - 1).toFixed(1)} ${H - pad.b} L${pad.l} ${H - pad.b} Z`); area.setAttribute("class", "ar"); svg.appendChild(area);
    const line = document.createElementNS(ns, "path"); line.setAttribute("d", d); line.setAttribute("class", "ln"); svg.appendChild(line);
    const t0 = document.createElementNS(ns, "text"); t0.setAttribute("x", pad.l); t0.setAttribute("y", H - 4); t0.setAttribute("class", "lb"); t0.textContent = ago(pts[0].t) + " ago"; svg.appendChild(t0);
    const t1 = document.createElementNS(ns, "text"); t1.setAttribute("x", W_ - pad.r); t1.setAttribute("y", H - 4); t1.setAttribute("class", "lb"); t1.setAttribute("text-anchor", "end"); t1.textContent = "now"; svg.appendChild(t1);
    box.appendChild(svg); return box;
  }

  function tradeBox(c, L) {
    const cv = L.curve, sym = c.symbol || "TOKEN";
    const box = el("div", "trade"); box.appendChild(el("div", "trade-k", "pump.fun · SOL · signed in your wallet"));
    const d = L.dex;
    if (!cv && !d) { box.appendChild(el("div", "est", L.err || "Reading the curve…")); return box; }
    if (!cv && d) { const n = el("div", "grad-note"); n.innerHTML = `<b>Trades on ${d.dex}.</b> No pump.fun curve for this mint. Buys and sells below route to the ${d.dex} pool through PumpPortal, with the launchpad's 3% in the same signature.`; box.appendChild(n); }
    else if (cv.complete) { const n = el("div", "grad-note"); n.innerHTML = `<b>Graduated.</b> This curve is complete. Liquidity is on PumpSwap, LP burned. Buys and sells below route there automatically.`; box.appendChild(n); }
    if (!W.publicKey) { const b = el("button", "place buy", "Connect wallet to trade"); b.type = "button"; b.onclick = openWallet; box.appendChild(b); return box; }
    const tabs = el("div", "ttabs");
    const bb = el("button", "buy" + (VIEW.side === "buy" ? " active" : ""), "Buy"); bb.type = "button"; const sb = el("button", "sell" + (VIEW.side === "sell" ? " active" : ""), "Sell"); sb.type = "button";
    bb.onclick = () => { VIEW.side = "buy"; VIEW.amt = ""; renderCoin(c.mint); }; sb.onclick = () => { VIEW.side = "sell"; VIEW.amt = ""; renderCoin(c.mint); };
    tabs.append(bb, sb); box.appendChild(tabs);
    const have = L.bal || 0, solBal = (LIVE.__wallet && LIVE.__wallet.sol) || 0;
    const amt = el("div", "tamt"); const inp = el("input"); inp.type = "number"; inp.min = "0"; inp.step = "any"; inp.placeholder = "0.00"; inp.value = VIEW.amt; amt.appendChild(inp); amt.appendChild(el("span", "", VIEW.side === "buy" ? "SOL" : sym)); box.appendChild(amt);
    const quick = el("div", "quick");
    const qs = VIEW.side === "buy" ? [["0.1", 0.1], ["0.5", 0.5], ["1", 1], ["max", Math.max(0, solBal - 0.01)]] : [["25%", have * 0.25], ["50%", have * 0.5], ["75%", have * 0.75], ["100%", have]];
    qs.forEach(([l, v]) => { const b = el("button", "", l); b.type = "button"; b.onclick = () => { inp.value = VIEW.side === "buy" ? (+v.toFixed(4)) : Math.floor(v); VIEW.amt = inp.value; est(); }; quick.appendChild(b); });
    box.appendChild(quick);
    const e = el("div", "est"); box.appendChild(e);
    const place = el("button", "place " + VIEW.side, VIEW.side === "buy" ? "Buy $" + sym : "Sell $" + sym); place.type = "button"; box.appendChild(place);
    const bal = el("div", "est"); bal.style.minHeight = "0"; bal.innerHTML = `wallet <b>${solBal.toFixed(4)} SOL</b> · you hold <b>${fmtT(have)} ${sym}</b>`; box.appendChild(bal);
    function est() {
      const v = parseFloat(inp.value) || 0; e.innerHTML = ""; place.disabled = true;
      if (v <= 0) { e.appendChild(el("span", "", VIEW.side === "buy" ? "Enter SOL to spend." : "Enter " + sym + " to sell.")); return; }
      const feeLine = (sol) => `redacted ${C.platformFeePct}% = ${(sol * C.platformFeePct / 100).toFixed(4)} SOL`;
      if (!cv || cv.complete) {
        const px = d && d.priceNative ? d.priceNative : 0; const outSol = px ? v * px : 0;
        e.innerHTML = VIEW.side === "buy" ? `${px ? "~<b>" + fmtT(v * (1 - C.platformFeePct / 100) / px) + " " + sym + "</b><br>" : ""}routes to ${d ? d.dex : "PumpSwap"} via PumpPortal · ${feeLine(v)} · slippage ${C.slippage}%` : `${px ? "~<b>" + (outSol * (1 - C.platformFeePct / 100)).toFixed(4) + " SOL</b> after fees<br>" : ""}routes to ${d ? d.dex : "PumpSwap"} via PumpPortal · ${px ? feeLine(outSol) : "redacted " + C.platformFeePct + "% of the SOL out"} · slippage ${C.slippage}%`;
        if (VIEW.side === "sell" && v > have) { e.appendChild(el("span", "warn", " You hold " + fmtT(have) + " " + sym + ".")); return; }
        place.disabled = false; return;
      }
      if (VIEW.side === "buy") { const q = quoteBuy(cv, v * (1 - C.platformFeePct / 100)); e.innerHTML = `~<b>${fmtT(q.tokens)} ${sym}</b> (${pct(q.tokens / C.supply)} of supply)<br>${feeLine(v)} · pump.fun 1% ${q.fee.toFixed(4)} SOL · impact ${pct(q.impact)}`; }
      else { if (v > have) { e.appendChild(el("span", "warn", "You hold " + fmtT(have) + " " + sym + ".")); return; } const q = quoteSell(cv, v); e.innerHTML = `~<b>${(q.solOut * (1 - C.platformFeePct / 100)).toFixed(4)} SOL</b> after fees<br>${feeLine(q.solOut)} · pump.fun 1% ${q.fee.toFixed(4)} SOL · impact ${pct(q.impact)}`; }
      place.disabled = false;
    }
    inp.addEventListener("input", () => { VIEW.amt = inp.value; est(); }); est();
    place.onclick = async () => {
      const v = parseFloat(inp.value) || 0; if (v <= 0 || VIEW.busy) return;
      VIEW.busy = true; place.disabled = true; place.textContent = "Sign in wallet…";
      try {
        let feeSol = 0;
        if (VIEW.side === "buy") feeSol = v * C.platformFeePct / 100;
        else if (cv && !cv.complete) feeSol = quoteSell(cv, v).solOut * C.platformFeePct / 100;
        else if (d && d.priceNative) feeSol = v * d.priceNative * C.platformFeePct / 100;
        const sig = await P.trade({ wallet: W, mint: c.mint, action: VIEW.side, amount: VIEW.side === "buy" ? v * (1 - C.platformFeePct / 100) : v, denominatedInSol: VIEW.side === "buy", feeSol, feeTo: C.launchpadWallet });
        toast((VIEW.side === "buy" ? "Bought" : "Sold") + " · " + short(sig)); VIEW.amt = "";
        await refreshCoin(c.mint); refreshWallet(); renderAll();
      } catch (er) { toast(errMsg(er), true, 6000); place.disabled = false; place.textContent = VIEW.side === "buy" ? "Buy $" + sym : "Sell $" + sym; }
      finally { VIEW.busy = false; }
    };
    return box;
  }

  function bridgeBox(c, L) {
    const sym = c.symbol || "TOKEN", have = L.bal || 0;
    const box = el("div", "bridge");
    box.appendChild(el("div", "trade-k", "the crossing · burn on pump.fun, reborn on Monero 1:1"));
    const pair = el("div", "pair");
    const a = el("div", "pair-side"); a.appendChild(el("span", "", "pump.fun · Solana")); a.appendChild(el("b", "", W.publicKey ? fmtT(have) + " " + sym : "connect wallet")); a.appendChild(el("small", "", short(c.mint)));
    const arrow = el("div", "pair-arrow", "→ burn → mint 1:1 →");
    const b = el("div", "pair-side xmr"); b.appendChild(el("span", "", "Monero · inscribed")); b.appendChild(el("b", "", "holder key")); b.appendChild(el("small", "", short(S.holderKey)));
    pair.append(a, arrow, b); box.appendChild(pair);
    const row = el("div", "bridge-row"); const amt = el("div", "tamt"); const inp = el("input"); inp.type = "number"; inp.min = "0"; inp.step = "1"; inp.placeholder = "0"; inp.value = VIEW.bamt; amt.appendChild(inp); amt.appendChild(el("span", "", sym)); row.appendChild(amt);
    const quick = el("div", "quick"); [["25%", have * 0.25], ["50%", have * 0.5], ["100%", have]].forEach(([l, v]) => { const q = el("button", "", l); q.type = "button"; q.onclick = () => { inp.value = Math.floor(v); VIEW.bamt = inp.value; }; quick.appendChild(q); }); row.appendChild(quick); box.appendChild(row);
    const e = el("div", "est"); e.style.minHeight = "0";
    e.innerHTML = C.api.bridge ? `The launchpad handles the swap by hand for now: your request is queued with your holder key, the burn is confirmed on Solana, and the same amount is inscribed to your key on Monero.` : `<span class="warn">Bridge endpoint not configured.</span> Set api.bridge in config.js. Requests are kept locally until then.`;
    box.appendChild(e);
    const go = el("button", "place bridge-btn", "Burn and cross"); go.type = "button"; box.appendChild(go);
    go.onclick = async () => {
      const v = Math.floor(parseFloat(inp.value) || 0); if (v <= 0) return toast("Enter an amount.", true);
      if (!W.publicKey) return openWallet();
      if (v > have) return toast("You hold " + fmtT(have) + " " + sym + ".", true);
      const req = { mint: c.mint, amount: v, holderKey: S.holderKey, wallet: W.publicKey, at: now() };
      if (C.api.bridge) {
        try { go.disabled = true; const r = await fetch(C.api.bridge, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) }); if (!r.ok) throw new Error("Bridge backend " + r.status); const j = await r.json(); toast("Bridge request accepted" + (j.inscription ? " · " + j.inscription : "") + ". Follow the burn instructions from the launchpad."); }
        catch (er) { toast(errMsg(er), true, 6000); } finally { go.disabled = false; }
      } else { (S.bridgeQueue = S.bridgeQueue || []).push(req); save(); toast("Saved locally: " + fmtT(v) + " " + sym + " → " + short(S.holderKey) + ". Configure api.bridge to send it."); }
      VIEW.bamt = "";
    };
    return box;
  }

  function renderCoin(mint) {
    const c = S.coins.find((x) => x.mint === mint) || { mint }; const L = live(mint), cv = L.curve;
    const sym = c.symbol || (L.meta && L.meta.symbol) || "?"; const name = c.name || (L.meta && L.meta.name) || short(mint);
    $("coin-title").textContent = name + " · $" + sym;
    $("coin-bar").textContent = `redacted@monero › ${String(sym).toLowerCase()} · ${short(mint)}`;
    const chips = $("coin-chips"); chips.innerHTML = "";
    const dx = L.dex;
    if (c.featured) chips.appendChild(el("span", "here", "✦ summoned here"));
    chips.appendChild(el("span", cv && cv.complete ? "grad" : "live", cv ? (cv.complete ? "ascended · PumpSwap" : "alive on pump.fun") : dx ? "alive on " + dx.dex : "reading…"));
    if (dx && (!cv || cv.complete)) chips.appendChild(el("span", "", "mcap " + fmtUsd(dx.mcap)));
    else if (cv) chips.appendChild(el("span", "", "mcap " + fmtN(cv.mcap, 2) + " SOL"));
    const root = $("coin"); const st = root.scrollTop; root.innerHTML = "";

    const head = el("div", "coin-head"); head.appendChild(avatar({ ...c, meta: L.meta }));
    const hb = el("div"); hb.style.minWidth = "0";
    const h3 = el("h3", "", name); h3.appendChild(el("small", "", "$" + sym)); hb.appendChild(h3);
    const desc = c.description || (L.meta && L.meta.description); if (desc) hb.appendChild(el("p", "coin-desc", desc));
    const by = el("div", "coin-by");
    const creator = (cv && cv.creator) || c.creator; by.appendChild(el("span", "", (creator ? "creator " + (creator === C.launchpadWallet ? "redacted (fees → launchpad)" : creator === W.publicKey ? "you" : short(creator)) : "") + (c.createdAt ? " · " + ago(c.createdAt) + " ago" : "")));
    if (cv || /pump$/.test(mint)) { const pf = el("a", "", "pump.fun ↗"); pf.href = "https://pump.fun/coin/" + mint; pf.target = "_blank"; pf.rel = "noopener"; by.appendChild(pf); }
    if (dx) { const ds = el("a", "", "dexscreener ↗"); ds.href = dx.url; ds.target = "_blank"; ds.rel = "noopener"; by.appendChild(ds); }
    const sc = el("a", "", "solscan ↗"); sc.href = "https://solscan.io/token/" + mint; sc.target = "_blank"; sc.rel = "noopener"; by.appendChild(sc);
    const links = c.links || (L.meta && L.meta.links) || {};
    for (const [k, l] of [["web", "website"], ["x", "x"], ["tg", "telegram"]]) if (links[k]) { const a = el("a", "", l + " ↗"); a.href = links[k]; a.target = "_blank"; a.rel = "noopener"; by.appendChild(a); }
    hb.appendChild(by);
    const ids = el("div", "ids"); const r1 = el("div", "idrow"); r1.appendChild(el("span", "", "mint")); const code = el("code", "", mint); code.title = "click to copy"; code.style.cursor = "pointer"; code.onclick = () => navigator.clipboard && navigator.clipboard.writeText(mint).then(() => toast("Mint copied.")); r1.appendChild(code); ids.appendChild(r1);
    const r2 = el("div", "idrow"); r2.appendChild(el("span", "", "holder key")); r2.appendChild(el("code", "", S.holderKey)); ids.appendChild(r2); hb.appendChild(ids);
    head.appendChild(hb); root.appendChild(head);

    const kv = el("div", "kv"); const add = (k, v, s) => { const d = el("div"); d.appendChild(el("span", "", k)); const b = el("b", "", v); if (s) b.appendChild(el("small", "", s)); d.appendChild(b); kv.appendChild(d); };
    if (dx && (!cv || cv.complete)) {
      add("price", dx.priceUsd < 0.001 ? "$" + dx.priceUsd.toPrecision(3) : "$" + dx.priceUsd.toFixed(4), dx.priceNative ? dx.priceNative.toPrecision(3) + " SOL" : "");
      add("market cap", fmtUsd(dx.mcap), dx.dex); add("24h volume", fmtUsd(dx.vol24), dx.change24 != null ? (dx.change24 >= 0 ? "+" : "") + dx.change24.toFixed(1) + "%" : "");
      add("liquidity", fmtUsd(dx.liquidity), dx.pairs + (dx.pairs === 1 ? " pair" : " pairs")); add("holders", String(L.holders.length) + (L.holders.length >= 20 ? "+" : ""), "top 20 read"); add("you hold", W.publicKey ? fmtT(L.bal || 0) : "–", sym);
    }
    else if (cv && cv.complete && cv.vSol === 0) { add("price", "PumpSwap", "see pump.fun"); add("market cap", "PumpSwap", "pool"); add("in curve", "migrated", "LP burned"); }
    else if (cv) { add("price", fmtP(cv.price), "SOL"); add("market cap", fmtN(cv.mcap, 2) + " SOL", USD.sol ? fmtUsd(cv.mcap * USD.sol) : ""); add("in curve", cv.rSol.toFixed(2) + " SOL", "real"); add("holders", String(L.holders.length) + (L.holders.length >= 20 ? "+" : ""), "top 20 read"); add("curve", pct(cv.progress), cv.complete ? "done" : "to PumpSwap"); add("you hold", W.publicKey ? fmtT(L.bal || 0) : "–", sym); }
    else add("status", L.err || "reading…");
    root.appendChild(kv);
    const main = el("div", "coin-main"); main.appendChild(chart(L, sym)); main.appendChild(tradeBox(c, L)); root.appendChild(main);
    root.appendChild(bridgeBox(c, L));

    if (cv) {
      const cs = el("div", "sec"); const ch = el("div", "sec-h"); ch.append("pump.fun bonding curve"); ch.appendChild(el("b", "", cv.complete ? "graduated" : `${cv.rSol.toFixed(2)} SOL · ${fmtT(cv.rTok)} ${sym} left`)); cs.appendChild(ch);
      const cvb = el("div", "curve"); const p = el("div", "prog" + (cv.complete ? " grad" : "")); const i = el("i"); i.style.width = (cv.progress * 100).toFixed(1) + "%"; p.appendChild(i); cvb.appendChild(p);
      cvb.appendChild(el("p", "", cv.complete ? "Curve complete. Liquidity on PumpSwap, LP burned. Bridging still works: burning a PumpSwap token is the same as burning a curve token." : `${fmtT(cv.rTok)} ${sym} still for sale on the curve. When it empties (about ${C.gradSol} SOL), pump.fun moves the liquidity to PumpSwap and burns the LP.`));
      cs.appendChild(cvb); root.appendChild(cs);
    }

    const hs = el("div", "sec"); const hh = el("div", "sec-h"); hh.append("top holders"); hh.appendChild(el("b", "", L.holders.length + " read from chain")); hs.appendChild(hh);
    const ht = el("table", "tbl"); ht.innerHTML = `<thead><tr><th>holder</th><th class="r">tokens</th><th class="r">supply</th></tr></thead>`; const hbdy = el("tbody");
    L.holders.forEach((h) => { const tr = el("tr"); const td = el("td", h.owner === W.publicKey ? "you" : ""); td.appendChild(el("span", "hbar")).style.width = Math.max(4, (h.amount / C.supply) * 300).toFixed(0) + "px"; const isCurve = cv && h.amount > C.supply * 0.2 && h.owner !== W.publicKey; td.append(h.owner === W.publicKey ? "you" : short(h.owner) + (isCurve && !cv.complete ? " (curve)" : h.owner === creator ? " (creator)" : "")); tr.appendChild(td); tr.appendChild(el("td", "r", fmtT(h.amount))); tr.appendChild(el("td", "r", pct(h.amount / C.supply))); hbdy.appendChild(tr); });
    if (!L.holders.length) { const tr = el("tr"); tr.appendChild(el("td", "", L.holdersErr || "reading holders…")); hbdy.appendChild(tr); }
    ht.appendChild(hbdy); hs.appendChild(ht); root.appendChild(hs);

    const act = el("div", "sec"); const ah = el("div", "sec-h"); ah.append("activity"); const al = el("a", "", dx ? "every trade, on DexScreener ↗" : "every trade, on pump.fun ↗"); al.href = dx ? dx.url : "https://pump.fun/coin/" + mint; al.target = "_blank"; al.rel = "noopener"; ah.appendChild(al); act.appendChild(ah); root.appendChild(act);
    root.scrollTop = st;
  }

  // ---------------- routing ----------------
  let pollTimer = null, current = null;
  function route() {
    const m = (location.hash || "#/board").match(/^#\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
    if (m) {
      current = m[1]; document.body.classList.remove("no-coin"); $("coin-panel").hidden = false;
      if (!S.coins.some((c) => c.mint === current)) upsert({ mint: current, createdAt: now() });
      $("coin-panel").scrollIntoView({ block: "start", behavior: "smooth" });
      renderCoin(current); refreshCoin(current).then(() => { if (current === m[1]) renderCoin(current); });
      clearInterval(pollTimer); pollTimer = setInterval(() => { if (current && !VIEW.busy) Promise.all([refreshCurve(current), refreshDex(current)]).then(() => { const ae = document.activeElement; const typing = ae && ae.tagName === "INPUT" && $("coin").contains(ae); if (!typing) renderCoin(current); }); }, 20000);
    } else { current = null; clearInterval(pollTimer); $("coin-panel").hidden = true; document.body.classList.add("no-coin"); }
  }
  function refreshCurrent() { if (current) refreshCoin(current).then(() => renderCoin(current)); }
  function renderAll() { renderHeader(); renderStats(); renderFeatured(); route(); }

  // ---------------- boot ----------------
  function boot() {
    if (!window.solanaWeb3) { toast("Could not load @solana/web3.js from the CDN. Chain reads and trades are off.", true, 10000); }
    load();
    (C.featured || []).forEach((f) => { if (f && f.mint) upsert({ mint: f.mint, featured: true, createdAt: (S.coins.find((x) => x.mint === f.mint) || {}).createdAt || now() }); });
    save();
    bindCreate(); renderFeatured();

    $("connect").addEventListener("click", openWallet);
    // header menu: three lines on the right
    const menu = $("menu"), mbtn = $("menu-btn");
    const setMenu = (open) => { menu.hidden = !open; mbtn.setAttribute("aria-expanded", String(open)); mbtn.classList.toggle("open", open); };
    mbtn.addEventListener("click", (e) => { e.stopPropagation(); setMenu(menu.hidden); });
    document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) setMenu(false); });
    menu.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-go]"); if (!b) { setMenu(false); return; }
      const sec = $(b.dataset.go); if (!sec) { location.href = "index.html"; return; } const wasHidden = sec.hidden;
      if (b.dataset.go === "explain") sec.hidden = !wasHidden; else sec.hidden = false;
      setMenu(false);
      if (!sec.hidden) { sec.scrollIntoView({ block: "start", behavior: "smooth" }); if (b.dataset.go === "create") setTimeout(() => $("c-name").focus({ preventScroll: true }), 400); }
    });
    $("wm-close").addEventListener("click", closeWallet);
    $("wallet-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeWallet(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeWallet(); });
    window.addEventListener("hashchange", () => { VIEW.amt = ""; VIEW.bamt = ""; route(); });
    W.on(() => { renderHeader(); refreshWallet(); refreshCurrent(); });
    document.title = "Redacted";
    renderAll();
    W.autoConnect();
    fetchHeight(); setInterval(fetchHeight, 120000);
    fetchUsd(); setInterval(fetchUsd, 90000);
    syncRegistry(); setInterval(syncRegistry, 60000);
    if (window.solanaWeb3) { refreshBoard(); setInterval(refreshBoard, 60000); }
    setInterval(refreshWallet, 45000);
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
