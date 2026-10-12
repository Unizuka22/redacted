/* Redacted — Solana wallet connect. Phantom, Solflare, Backpack, or any injected provider. */
(() => {
  "use strict";
  const listeners = new Set();
  const W = {
    provider: null, name: null, publicKey: null,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit() { listeners.forEach((fn) => { try { fn(W); } catch (e) { console.error(e); } }); },

    // Wallet Standard registry: every installed wallet announces itself with its own icon.
    standard: {},
    listenStandard() {
      const take = (w) => { if (w && w.name && w.icon) W.standard[w.name.toLowerCase()] = w.icon; };
      try { window.addEventListener("wallet-standard:register-wallet", (e) => { if (e.detail) e.detail({ register: (...ws) => ws.forEach(take) }); }); } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register: (...ws) => ws.forEach(take) } })); } catch { /* ignore */ }
      try { (window.navigator.wallets || []).forEach((w) => { if (typeof w === "object") take(w); }); } catch { /* ignore */ }
    },
    iconFor(name, fallback) { return W.standard[name.toLowerCase()] || fallback; },

    detect() {
      const list = [];
      const add = (name, p, url, icon) => list.push({ name, provider: p || null, url, icon: W.iconFor(name, icon) });
      add("Phantom", window.phantom && window.phantom.solana && window.phantom.solana.isPhantom ? window.phantom.solana : (window.solana && window.solana.isPhantom ? window.solana : null), "https://phantom.app/", "wallets/phantom.svg");
      add("Solflare", window.solflare && window.solflare.isSolflare ? window.solflare : null, "https://solflare.com/", "wallets/solflare.svg");
      add("Backpack", window.backpack && window.backpack.solana ? window.backpack.solana : null, "https://backpack.app/", "wallets/backpack.png");
      if (window.solana && !list.some((x) => x.provider === window.solana)) {
        const std = Object.entries(W.standard)[0];
        add(std ? std[0].replace(/\b\w/g, (c) => c.toUpperCase()) : "Injected wallet", window.solana, "", std ? std[1] : "mark.svg");
      }
      return list;
    },

    async connect(entry) {
      if (!entry || !entry.provider) throw new Error("Wallet not installed");
      const p = entry.provider;
      const res = await p.connect();
      const pk = (res && res.publicKey) || p.publicKey;
      if (!pk) throw new Error("Wallet did not return a public key");
      W.provider = p; W.name = entry.name; W.publicKey = pk.toString ? pk.toString() : String(pk);
      try { localStorage.setItem("redacted.wallet", entry.name); } catch { /* ignore */ }
      if (p.on) {
        p.on("disconnect", () => { W.provider = null; W.name = null; W.publicKey = null; W.emit(); });
        p.on("accountChanged", (npk) => { if (npk) { W.publicKey = npk.toString(); W.emit(); } else W.disconnect(); });
      }
      W.emit();
      return W.publicKey;
    },

    async autoConnect() {
      let name = null; try { name = localStorage.getItem("redacted.wallet"); } catch { /* ignore */ }
      if (!name) return false;
      const e = W.detect().find((x) => x.name === name && x.provider);
      if (!e) return false;
      try { const r = await e.provider.connect({ onlyIfTrusted: true }); if (r || e.provider.publicKey) { W.provider = e.provider; W.name = e.name; W.publicKey = (r && r.publicKey ? r.publicKey : e.provider.publicKey).toString(); W.emit(); return true; } } catch { /* user has not approved before */ }
      return false;
    },

    async disconnect() {
      try { if (W.provider && W.provider.disconnect) await W.provider.disconnect(); } catch { /* ignore */ }
      W.provider = null; W.name = null; W.publicKey = null;
      try { localStorage.removeItem("redacted.wallet"); } catch { /* ignore */ }
      W.emit();
    },

    async signTransaction(tx) {
      if (!W.provider) throw new Error("Connect a wallet first");
      return W.provider.signTransaction(tx);
    },
  };
  W.listenStandard();
  window.RedactedWallet = W;
})();
