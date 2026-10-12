/* Redacted glitch layer: small pixelated static patches, the same language as the logo.
 * A few 3px-pixel blocks of black/white noise flash somewhere on the page for a split
 * second every few seconds. Nothing moves, nothing tears, text stays readable.
 */
(() => {
  "use strict";
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  const docs = document.body.classList.contains("docs-page");
  const PX = 3;                                  // css px per noise pixel
  const GAP = docs ? [3800, 8000] : [2200, 5200]; // ms between bursts
  const FPS = 30;

  const cv = document.createElement("canvas"); cv.className = "pxglitch"; cv.setAttribute("aria-hidden", "true");
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d");
  let W = 0, H = 0;
  function size() { W = Math.ceil(innerWidth / PX); H = Math.ceil(innerHeight / PX); cv.width = W; cv.height = H; }
  size(); addEventListener("resize", size);

  const patches = [];
  let raf = 0, last = 0;

  // anchors: brand, headings, big numbers, cards. Patches like to sit on an edge of these.
  function anchors() {
    const out = [];
    document.querySelectorAll(".brand-logo, .brand-name, h2, .docs-body h1, .docs-body h2, .stat b, .king, .card, .coin-head h3, .launch, .pulse").forEach((el) => {
      const r = el.getBoundingClientRect(); if (r.width > 20 && r.bottom > 0 && r.top < innerHeight) out.push(r);
    });
    return out;
  }

  function spawn(near) {
    const w = 6 + Math.floor(Math.random() * 26);        // cells
    const h = 1 + Math.floor(Math.random() * 5);
    let x, y;
    if (near) {
      const edge = Math.random();
      x = Math.floor((near.left + Math.random() * Math.max(1, near.width - w * PX)) / PX);
      y = Math.floor((edge < 0.5 ? near.top - h * PX * Math.random() : near.bottom - h * PX * (1 - Math.random())) / PX);
    } else { x = Math.floor(Math.random() * (W - w)); y = Math.floor(Math.random() * (H - h)); }
    patches.push({ x, y, w, h, born: performance.now(), ttl: 90 + Math.random() * 260, drift: Math.random() < 0.4 ? (Math.random() < 0.5 ? -1 : 1) : 0 });
  }

  function burst(n, rect) {
    const a = anchors();
    for (let i = 0; i < n; i++) spawn(rect || (Math.random() < 0.7 && a.length ? a[Math.floor(Math.random() * a.length)] : null));
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / FPS) return; last = now;
    ctx.clearRect(0, 0, W, H);
    for (let i = patches.length - 1; i >= 0; i--) {
      const p = patches[i];
      if (now - p.born > p.ttl) { patches.splice(i, 1); continue; }
      if (p.drift) p.x += p.drift;
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
        const v = Math.random();
        if (v < 0.30) continue;                               // holes keep it light
        ctx.fillStyle = v < 0.62 ? "#000" : v < 0.94 ? "#fff" : "#ff6600";
        ctx.fillRect(p.x + x, p.y + y, 1, 1);
      }
    }
    if (!patches.length) { cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, W, H); }
  }

  function pulse() {
    burst(1 + Math.floor(Math.random() * 3));
    setTimeout(pulse, GAP[0] + Math.random() * (GAP[1] - GAP[0]));
  }

  const brand = document.querySelector(".brand");
  if (brand) brand.addEventListener("mouseenter", () => burst(4, brand.getBoundingClientRect()));
  addEventListener("hashchange", () => setTimeout(() => burst(5), 50));

  window.redactedGlitch = () => burst(6);       // manual trigger for testing
  setTimeout(() => burst(4), 600);
  setTimeout(pulse, 1800);
})();
