/* Redacted brand mark: TV static that resolves into the Monero logo.
 * Replaces every <img class="brand-logo"> with a pixel canvas. Noise never fully leaves.
 */
(() => {
  "use strict";
  const N = 32;               // cells per side
  const PX = 3;               // backing pixels per cell
  const SIZE = N * PX;
  const FPS = 30;
  const FORM = 2600;          // ms to resolve from static into the logo
  const HOLD = 8000;          // ms formed before it dissolves again
  const MELT = 520;           // ms to dissolve back into static
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function init(img) {
    const cv = document.createElement("canvas");
    cv.width = SIZE; cv.height = SIZE; cv.className = img.className + " brand-noise"; cv.setAttribute("aria-hidden", "true");
    img.replaceWith(cv);
    const ctx = cv.getContext("2d");

    // sample the SVG into an N×N target grid
    const off = document.createElement("canvas"); off.width = N; off.height = N;
    const octx = off.getContext("2d", { willReadFrequently: true });
    let target = null;
    const im = new Image();
    im.onload = () => { octx.clearRect(0, 0, N, N); octx.drawImage(im, 0, 0, N, N); target = octx.getImageData(0, 0, N, N).data; };
    im.src = img.getAttribute("src");

    // per-cell reveal threshold: centre first, random grain on top
    const thr = new Float32Array(N * N);
    const scramble = () => {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = (x + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.5;
        const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.72);
        thr[y * N + x] = 0.55 * d + 0.45 * Math.random();
      }
    };
    scramble();

    let t0 = performance.now(), last = 0, hover = false;
    cv.parentElement && cv.parentElement.addEventListener("mouseenter", () => { if (!hover) { hover = true; t0 = performance.now() - FORM - HOLD; } });
    cv.parentElement && cv.parentElement.addEventListener("mouseleave", () => { hover = false; });

    function reveal(now) {
      if (reduce) return 1;
      const e = now - t0;
      if (e < FORM) return ease(e / FORM);
      if (e < FORM + HOLD) return 1;
      if (e < FORM + HOLD + MELT) return 1 - ease((e - FORM - HOLD) / MELT);
      t0 = now; scramble(); return 0;
    }

    function draw(r) {
      ctx.clearRect(0, 0, SIZE, SIZE);
      const flicker = 0.03 + 0.25 * (1 - r);      // formed cells still twitch
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const formed = target && r >= thr[i] && Math.random() > flicker;
          if (formed) {
            const a = target[i * 4 + 3];
            if (a < 90) continue;                   // outside the circle: transparent once formed
            const k = i * 4;
            // slight brightness jitter so the logo keeps a CRT shimmer
            const j = 1 + (Math.random() - 0.5) * 0.08;
            ctx.fillStyle = `rgb(${target[k] * j | 0},${target[k + 1] * j | 0},${target[k + 2] * j | 0})`;
          } else {
            // static: mostly black and white, a few greys, fades out around the edge as it forms
            const v = Math.random(); const g = v < 0.42 ? 0 : v < 0.84 ? 255 : (v * 255) | 0;
            const outside = target && target[i * 4 + 3] < 90;
            const alpha = outside ? Math.max(0, 1 - r * 1.15) : 1;
            if (alpha <= 0.02) continue;
            ctx.fillStyle = `rgba(${g},${g},${g},${alpha})`;
          }
          ctx.fillRect(x * PX, y * PX, PX, PX);
        }
      }
      // scanlines + a rolling bar, the TV part
      ctx.fillStyle = "rgba(0,0,0,.22)";
      for (let y = 1; y < N; y += 2) ctx.fillRect(0, y * PX, SIZE, 1);
      const bar = ((performance.now() / 14) % (SIZE + 20)) - 10;
      ctx.fillStyle = "rgba(255,255,255,.07)"; ctx.fillRect(0, bar, SIZE, 6);
    }

    function frame(now) {
      requestAnimationFrame(frame);
      if (now - last < 1000 / FPS) return; last = now;
      draw(reveal(now));
    }
    requestAnimationFrame(frame);
  }

  const run = () => document.querySelectorAll("img.brand-logo").forEach(init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
