/* Redacted — launchpad configuration. Fill these in. Everything else reads from here. */
window.REDACTED_CONFIG = {
  // The launchpad wallet. Coins are created FROM this wallet by your backend, so every
  // pump.fun creator fee is paid to it. Also the destination for dev-buy SOL at launch.
  launchpadWallet: "",

  // Your backend. Leave blank until it exists; the UI explains what is missing.
  api: {
    launch: "",   // POST multipart: image, name, symbol, description, website, twitter, telegram, devBuySol, buyer, transferSig -> { mint }
    coins: "",    // GET  -> [{ mint, name, symbol, image, description, createdAt }]
    bridge: "",   // POST json: { mint, amount, holderKey, burnSig, wallet } -> { ok, inscription }
  },

  // Coins shown on the front page as summoned here. Live data comes from DexScreener and the chain.
  featured: [
    { mint: "9N3rcoL5R1ysfDJiAX2kL4fw3MQHbfxMEZqshBNcq5ZV" },
  ],

  // How coins get created when you press Launch.
  //   "backend" : through api.launch, creator = launchpadWallet (fees to launchpad). Recommended.
  //   "wallet"  : the connected wallet signs the create itself via PumpPortal. Creator = the user,
  //               so creator fees go to THEM, not the launchpad. Useful only for testing.
  createMode: "backend",

  // Launchpad economics. The fee is appended to every buy/sell transaction as a transfer to
  // launchpadWallet, signed in the same wallet prompt. The birth cost is moved at launch on top
  // of the dev buy. Breakdown of the 0.7 SOL is in the docs under Costs.
  platformFeePct: 3,
  launchCostSol: 0.7,

  // Solana RPC endpoints, tried in order. Public ones rate-limit fast; put a keyed endpoint
  // (Helius, Triton, QuickNode) first before real traffic.
  rpc: ["https://solana-rpc.publicnode.com", "https://solana.drpc.org", "https://api.mainnet-beta.solana.com"],

  // PumpPortal local-transaction endpoint for buy / sell / (wallet-mode) create.
  pumpPortal: "https://pumpportal.fun/api/trade-local",
  pumpIpfs: "https://pump.fun/api/ipfs",
  slippage: 10,          // percent
  priorityFee: 0.0005,   // SOL

  pumpProgram: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  metaplexProgram: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  gradSol: 85,
  curveTokens: 793_100_000,
  supply: 1_000_000_000,
};
