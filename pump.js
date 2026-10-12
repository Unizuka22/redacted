/* Redacted — pump.fun on-chain reads and PumpPortal transactions. Needs solanaWeb3 (CDN) and config.js. */
(() => {
  "use strict";
  const C = window.REDACTED_CONFIG;
  const web3 = window.solanaWeb3;
  const enc = (s) => new TextEncoder().encode(s);
  const DECIMALS = 6, LAMPORTS = 1e9, UNIT = 1e6;

  // ---- RPC with failover ----
  let conns = null, idx = 0;
  const TIMEOUT = 9000;
  function connection() { if (!conns) conns = C.rpc.map((u) => new web3.Connection(u, { commitment: "confirmed", disableRetryOnRateLimit: true })); return conns[idx]; }
  const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("RPC timeout")), ms))]);
  async function withRpc(fn, ms = TIMEOUT) {
    let last;
    for (let i = 0; i < C.rpc.length; i++) {
      try { return await timeout(fn(connection()), ms); } catch (e) { last = e; idx = (idx + 1) % C.rpc.length; }
    }
    throw last;
  }

  const pk = (s) => new web3.PublicKey(s);
  const PUMP = () => pk(C.pumpProgram), META = () => pk(C.metaplexProgram);
  const curvePda = (mint) => web3.PublicKey.findProgramAddressSync([enc("bonding-curve"), pk(mint).toBytes()], PUMP())[0];
  const metaPda = (mint) => web3.PublicKey.findProgramAddressSync([enc("metadata"), META().toBytes(), pk(mint).toBytes()], META())[0];

  function u64(dv, o) { return Number(dv.getBigUint64(o, true)); }
  function decodeCurve(data) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const vTok = u64(dv, 8) / UNIT, vSol = u64(dv, 16) / LAMPORTS, rTok = u64(dv, 24) / UNIT, rSol = u64(dv, 32) / LAMPORTS;
    const total = u64(dv, 40) / UNIT, complete = data[48] === 1;
    let creator = null; if (data.length >= 81) { const c = new web3.PublicKey(data.slice(49, 81)).toBase58(); if (!/^1+$/.test(c)) creator = c; }
    const price = vTok > 0 ? vSol / vTok : 0;
    return { vTok, vSol, rTok, rSol, total, complete, creator, price, mcap: price * C.supply, progress: complete ? 1 : Math.min(1, 1 - rTok / C.curveTokens) };
  }
  function readStr(dv, data, o) { const n = dv.getUint32(o, true); const s = new TextDecoder().decode(data.slice(o + 4, o + 4 + n)); return [s.replace(/\0+$/g, "").trim(), o + 4 + n]; }
  function decodeMeta(data) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = 65; let name, symbol, uri;
    [name, o] = readStr(dv, data, o); [symbol, o] = readStr(dv, data, o); [uri, o] = readStr(dv, data, o);
    return { name, symbol, uri };
  }

  const P = {
    short: (s) => (s ? s.slice(0, 4) + "…" + s.slice(-4) : ""),
    // ipfs.io refuses browser origins; rewrite any ipfs url to gateways that allow CORS, in order.
    gateways(u) {
      const m = String(u).match(/(?:ipfs:\/\/|\/ipfs\/)([A-Za-z0-9]+(?:\/[^\s?#]*)?)/);
      if (!m) return [u];
      const cid = m[1];
      return ["https://pump.mypinata.cloud/ipfs/" + cid, "https://gateway.pinata.cloud/ipfs/" + cid, "https://cf-ipfs.com/ipfs/" + cid, "https://dweb.link/ipfs/" + cid, "https://ipfs.io/ipfs/" + cid];
    },
    isPubkey(s) { try { pk(s); return true; } catch { return false; } },

    // Live curve state for a mint. Null if no pump.fun curve exists for it.
    async curve(mint) {
      return withRpc(async (c) => { const ai = await c.getAccountInfo(curvePda(mint)); if (!ai) return null; return decodeCurve(ai.data); });
    },

    // On-chain name / symbol / uri and the off-chain json behind it.
    async metadata(mint) {
      const m = await withRpc(async (c) => { const ai = await c.getAccountInfo(metaPda(mint)); return ai ? decodeMeta(ai.data) : null; });
      if (!m) return null;
      let json = null;
      if (m.uri) { for (const u of P.gateways(m.uri)) { try { const r = await fetch(u, { cache: "force-cache" }); if (r.ok) { json = await r.json(); break; } } catch { /* next gateway */ } } }
      let image = json && json.image ? P.gateways(json.image)[0] : null;
      return { name: m.name, symbol: m.symbol, uri: m.uri, description: json && json.description || "", image, links: { web: json && json.website || "", x: json && json.twitter || "", tg: json && json.telegram || "" } };
    },

    // DexScreener: best Solana pair for a mint (by liquidity). Works for any DEX, before or after pump.fun.
    async dex(mint) {
      const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + mint, { cache: "no-store" });
      if (!r.ok) throw new Error("DexScreener " + r.status);
      const j = await r.json();
      const pairs = (j.pairs || []).filter((x) => x.chainId === "solana");
      if (!pairs.length) return null;
      pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
      const x = pairs[0];
      return {
        pair: x.pairAddress, dex: x.dexId, url: x.url, name: x.baseToken && x.baseToken.name, symbol: x.baseToken && x.baseToken.symbol,
        priceUsd: +x.priceUsd || 0, priceNative: +x.priceNative || 0, mcap: x.marketCap || x.fdv || 0,
        vol24: (x.volume && x.volume.h24) || 0, change24: x.priceChange && typeof x.priceChange.h24 === "number" ? x.priceChange.h24 : null,
        liquidity: (x.liquidity && x.liquidity.usd) || 0, image: x.info && x.info.imageUrl, created: x.pairCreatedAt || null, pairs: pairs.length,
      };
    },

    // Largest holders with owners resolved.
    async holders(mint) {
      return withRpc(async (c) => {
        const big = await c.getTokenLargestAccounts(pk(mint));
        const accts = big.value.slice(0, 20);
        if (!accts.length) return [];
        const infos = await c.getMultipleParsedAccounts(accts.map((a) => a.address));
        return accts.map((a, i) => { const inf = infos.value[i]; const owner = inf && inf.data && inf.data.parsed ? inf.data.parsed.info.owner : a.address.toBase58(); return { owner, tokenAccount: a.address.toBase58(), amount: Number(a.amount) / UNIT }; });
      });
    },

    async balance(owner, mint) {
      return withRpc(async (c) => { const r = await c.getParsedTokenAccountsByOwner(pk(owner), { mint: pk(mint) }); return r.value.reduce((s, x) => s + (x.account.data.parsed.info.tokenAmount.uiAmount || 0), 0); });
    },
    async solBalance(owner) { return withRpc(async (c) => (await c.getBalance(pk(owner))) / LAMPORTS); },

    // Recent signatures on the curve account, for an activity link count.
    async activityCount(mint) { return withRpc(async (c) => (await c.getSignaturesForAddress(curvePda(mint), { limit: 50 })).length); },

    // PumpPortal: build a buy/sell transaction, sign with the wallet, send.
    async trade({ wallet, mint, action, amount, denominatedInSol, feeSol = 0, feeTo = "" }) {
      const body = { publicKey: wallet.publicKey, action, mint, amount, denominatedInSol: denominatedInSol ? "true" : "false", slippage: C.slippage, priorityFee: C.priorityFee, pool: "auto" };
      const r = await fetch(C.pumpPortal, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("PumpPortal " + r.status + ": " + (await r.text()).slice(0, 160));
      let tx = web3.VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
      if (feeSol > 0 && feeTo) tx = await P.withFee(tx, wallet.publicKey, feeTo, feeSol);
      const signed = await wallet.signTransaction(tx);
      return withRpc(async (c) => { const sig = await c.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 }); await c.confirmTransaction(sig, "confirmed"); return sig; }, 120000);
    },

    // Rebuild a PumpPortal transaction with the launchpad fee transfer appended, same payer, same blockhash.
    async withFee(tx, payer, feeTo, feeSol) {
      return withRpc(async (c) => {
        const lookups = [];
        for (const l of tx.message.addressTableLookups || []) { const r = await c.getAddressLookupTable(l.accountKey); if (r.value) lookups.push(r.value); }
        const msg = web3.TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: lookups });
        msg.instructions.push(web3.SystemProgram.transfer({ fromPubkey: pk(payer), toPubkey: pk(feeTo), lamports: Math.round(feeSol * LAMPORTS) }));
        const { blockhash } = await c.getLatestBlockhash("confirmed");
        msg.recentBlockhash = blockhash;
        return new web3.VersionedTransaction(msg.compileToV0Message(lookups));
      });
    },

    // Plain SOL transfer from the connected wallet (dev buy + launch cost to the launchpad wallet).
    async transferSol({ wallet, to, sol }) {
      return withRpc(async (c) => {
        // wallet signing can take as long as the user needs; no short timeout here
        const from = pk(wallet.publicKey);
        const tx = new web3.Transaction().add(web3.SystemProgram.transfer({ fromPubkey: from, toPubkey: pk(to), lamports: Math.round(sol * LAMPORTS) }));
        const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash; tx.feePayer = from;
        const signed = await wallet.signTransaction(tx);
        const sig = await c.sendRawTransaction(signed.serialize());
        await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        return sig;
      }, 180000);
    },

    // Wallet-mode create: metadata to pump.fun IPFS, then a PumpPortal create tx signed by mint + wallet.
    async createWithWallet({ wallet, form, devBuySol }) {
      const fd = new FormData();
      if (form.file) fd.append("file", form.file);
      fd.append("name", form.name); fd.append("symbol", form.symbol); fd.append("description", form.description || "");
      if (form.twitter) fd.append("twitter", form.twitter); if (form.telegram) fd.append("telegram", form.telegram); if (form.website) fd.append("website", form.website);
      fd.append("showName", "true");
      const up = await fetch(C.pumpIpfs, { method: "POST", body: fd });
      if (!up.ok) throw new Error("pump.fun IPFS upload failed (" + up.status + ")");
      const meta = await up.json();
      const mintKp = web3.Keypair.generate();
      const body = { publicKey: wallet.publicKey, action: "create", tokenMetadata: { name: form.name, symbol: form.symbol, uri: meta.metadataUri }, mint: mintKp.publicKey.toBase58(), denominatedInSol: "true", amount: devBuySol || 0, slippage: C.slippage, priorityFee: C.priorityFee, pool: "pump" };
      const r = await fetch(C.pumpPortal, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("PumpPortal create " + r.status + ": " + (await r.text()).slice(0, 160));
      const tx = web3.VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
      tx.sign([mintKp]);
      const signed = await wallet.signTransaction(tx);
      const sig = await withRpc(async (c) => { const s = await c.sendRawTransaction(signed.serialize(), { maxRetries: 3 }); await c.confirmTransaction(s, "confirmed"); return s; }, 120000);
      return { mint: mintKp.publicKey.toBase58(), signature: sig };
    },
  };
  window.RedactedPump = P;
})();
