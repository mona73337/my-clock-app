const CHAIN_SOURCE_URL =
  "https://raw.githubusercontent.com/blockscout/chainscout/main/data/chains.json";
const REQUEST_INTERVAL_MS = 380;
const SCANNER_WORKERS = 3;

const FALLBACK_CHAINS = [
  {
    chainId: "1",
    name: "Ethereum",
    nativeSymbol: "ETH",
    explorer: "https://eth.blockscout.com",
    color: "#627eea",
  },
  {
    chainId: "10",
    name: "OP Mainnet",
    nativeSymbol: "ETH",
    explorer: "https://explorer.optimism.io",
    color: "#ff0420",
  },
  {
    chainId: "100",
    name: "Gnosis",
    nativeSymbol: "xDAI",
    explorer: "https://gnosis.blockscout.com",
    color: "#48a9a6",
  },
  {
    chainId: "137",
    name: "Polygon",
    nativeSymbol: "POL",
    explorer: "https://polygon.blockscout.com",
    color: "#8247e5",
  },
  {
    chainId: "8453",
    name: "Base",
    nativeSymbol: "ETH",
    explorer: "https://base.blockscout.com",
    color: "#2d6cff",
  },
  {
    chainId: "42161",
    name: "Arbitrum",
    nativeSymbol: "ETH",
    explorer: "https://arbitrum.blockscout.com",
    color: "#28a0f0",
  },
  {
    chainId: "43114",
    name: "Avalanche",
    nativeSymbol: "AVAX",
    explorer: "https://avax.blockscout.com",
    color: "#e84142",
  },
  {
    chainId: "534352",
    name: "Scroll",
    nativeSymbol: "ETH",
    explorer: "https://scroll.blockscout.com",
    color: "#e5d70f",
  },
];

const elements = {
  scanForm: document.querySelector("#scanForm"),
  walletAddress: document.querySelector("#walletAddress"),
  scanButton: document.querySelector("#scanButton"),
  resultSearch: document.querySelector("#resultSearch"),
  exportJson: document.querySelector("#exportJson"),
  progressWrap: document.querySelector("#progressWrap"),
  progressBanana: document.querySelector("#progressBanana"),
  progressText: document.querySelector("#progressText"),
  networkStatus: document.querySelector("#networkStatus"),
  nftCount: document.querySelector("#nftCount"),
  collectionCount: document.querySelector("#collectionCount"),
  metricCollections: document.querySelector("#metricCollections"),
  metricItems: document.querySelector("#metricItems"),
  metricChains: document.querySelector("#metricChains"),
  metricContracts: document.querySelector("#metricContracts"),
  radialMeter: document.querySelector("#radialMeter"),
  collectionGroups: document.querySelector("#collectionGroups"),
  emptyState: document.querySelector("#emptyState"),
  logList: document.querySelector("#logList"),
  clearLog: document.querySelector("#clearLog"),
  collectionTemplate: document.querySelector("#collectionTemplate"),
  nftTemplate: document.querySelector("#nftTemplate"),
};

const state = {
  nfts: [],
  logs: [],
  scannedChains: [],
  isScanning: false,
  completedChains: 0,
  totalChains: 0,
};

let nextRequestAt = 0;
let requestQueue = Promise.resolve();

initialize();

function initialize() {
  bindEvents();
  renderCollections();
  renderLog();
}

function bindEvents() {
  elements.scanForm.addEventListener("submit", (event) => {
    event.preventDefault();
    scanWallet();
  });
  elements.resultSearch.addEventListener("input", renderCollections);
  elements.exportJson.addEventListener("click", exportJson);
  elements.clearLog.addEventListener("click", () => {
    state.logs = [];
    renderLog();
  });
}

async function scanWallet() {
  const address = elements.walletAddress.value.trim();

  if (!isAddress(address)) {
    addLog("Address", "Enter a valid 0x wallet address", "error");
    elements.walletAddress.focus();
    return;
  }

  state.nfts = [];
  state.logs = [];
  state.scannedChains = [];
  state.completedChains = 0;
  state.totalChains = 0;
  state.isScanning = true;
  nextRequestAt = 0;
  requestQueue = Promise.resolve();

  setLoading(true);
  renderCollections();
  renderLog();
  updateStatus("Loading chains");
  updateProgress(0, "Loading public EVM chain index");

  const chains = await loadChainsForScan();
  state.totalChains = chains.length;

  if (chains.length === 0) {
    state.isScanning = false;
    setLoading(false);
    addLog("Chains", "No public EVM chains available", "error");
    updateStatus("Idle");
    return;
  }

  addLog("Chains", `Scanning ${chains.length} public EVM explorers`, "info");
  updateStatus("Scanning");
  updateProgress(0, `0 of ${chains.length} chains scanned`);

  await scanChains(chains, address);

  state.nfts = dedupeNfts(state.nfts);
  state.isScanning = false;
  setLoading(false);
  updateStatus("Complete");
  updateProgress(100, `${state.completedChains} chains scanned`);
  renderCollections();
}

async function loadChainsForScan() {
  try {
    const payload = await fetchJson(CHAIN_SOURCE_URL, { rateLimited: false });
    const chains = parseChainscout(payload);
    if (chains.length > 0) return chains;
  } catch {
    addLog("Chains", "Using bundled explorer list", "warn");
  }
  return FALLBACK_CHAINS;
}

function parseChainscout(payload) {
  const seen = new Set();

  return Object.entries(payload || {})
    .map(([chainId, chain]) => {
      if (!chain || chain.isTestnet) return null;

      const explorer = (chain.explorers || []).find(
        (item) => item.hostedBy === "blockscout" && item.url,
      );
      if (!explorer) return null;

      const explorerUrl = normalizeExplorerUrl(explorer.url);
      const key = `${chainId}:${explorerUrl}`;
      if (seen.has(key)) return null;
      seen.add(key);

      return {
        chainId: String(chainId),
        name: cleanChainName(chain.name || `Chain ${chainId}`),
        nativeSymbol: chain.native_currency || "ETH",
        explorer: explorerUrl,
        color: colorFromString(chain.name || chainId),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.chainId) - Number(b.chainId));
}

async function scanChains(chains, address) {
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(SCANNER_WORKERS, chains.length) },
    async () => {
      while (cursor < chains.length) {
        const chain = chains[cursor];
        cursor += 1;
        await scanSingleChain(chain, address);
      }
    },
  );

  await Promise.all(workers);
}

async function scanSingleChain(chain, address) {
  updateStatus(chain.name);

  try {
    const tokenBalances = await fetchTokenBalances(chain, address);
    const nfts = normalizeNfts(tokenBalances, chain);

    state.nfts.push(...nfts);
    state.scannedChains.push({
      chainId: chain.chainId,
      name: chain.name,
      nfts: nfts.length,
    });

    if (nfts.length > 0) {
      addLog(
        chain.name,
        `${nfts.length} NFT${nfts.length === 1 ? "" : "s"} found`,
        "success",
      );
    } else {
      addLog(chain.name, "No NFTs found", "info");
    }
  } catch (error) {
    state.scannedChains.push({
      chainId: chain.chainId,
      name: chain.name,
      nfts: 0,
      error: error.message,
    });
    addLog(chain.name, error.message || "Explorer unavailable", "error");
  } finally {
    state.completedChains += 1;
    updateProgress(
      (state.completedChains / state.totalChains) * 100,
      `${state.completedChains} of ${state.totalChains} chains scanned`,
    );
    state.nfts = dedupeNfts(state.nfts);
    renderCollections();
  }
}

async function fetchTokenBalances(chain, address) {
  const payload = await fetchJson(
    `${chain.explorer}/api/v2/addresses/${address}/token-balances`,
    { allow404: true },
  );
  if (!payload) return [];
  return Array.isArray(payload) ? payload : payload.items || [];
}

function normalizeNfts(tokenBalances, chain) {
  return tokenBalances.map((item) => normalizeNft(item, chain)).filter(Boolean);
}

function normalizeNft(item, chain) {
  const token = item.token || {};
  const type = normalizeTokenType(token.type);

  if (type !== "ERC-721" && type !== "ERC-1155") return null;

  const raw = toBigInt(item.value);
  if (raw === 0n) return null;

  const contract = normalizeAddress(token.address_hash || token.address || "");
  const tokenId = String(item.token_id || item.token_instance?.id || "");
  const metadata = item.token_instance?.metadata || {};
  const tokenName = String(metadata.name || token.name || "Unknown NFT");
  const collectionName = String(token.name || "Unknown collection");
  const symbol = token.symbol || "NFT";
  const imageUrl =
    item.token_instance?.image_url ||
    metadata.image_url ||
    metadata.image ||
    token.icon_url ||
    "";

  return {
    id: `${chain.chainId}:${contract}:${type}:${tokenId}`,
    chainId: chain.chainId,
    chainName: chain.name,
    explorer: chain.explorer,
    type,
    name: tokenName,
    collectionName,
    symbol,
    contract,
    tokenId,
    imageUrl,
    balance: type === "ERC-1155" ? raw.toString() : "1",
    color: chain.color,
  };
}

async function fetchJson(url, options = {}) {
  const run = async () => {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });

    if (options.allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  if (options.rateLimited === false) return run();
  return enqueueRequest(run);
}

function enqueueRequest(task) {
  const queued = requestQueue.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait > 0) await delay(wait);
    nextRequestAt = Date.now() + REQUEST_INTERVAL_MS;
    return task();
  });

  requestQueue = queued.catch(() => undefined);
  return queued;
}

function dedupeNfts(nfts) {
  const map = new Map();
  nfts.forEach((nft) => {
    if (!nft) return;
    map.set(nft.id, nft);
  });
  return Array.from(map.values()).sort((a, b) => {
    if (a.chainName !== b.chainName) {
      return a.chainName.localeCompare(b.chainName);
    }
    return `${a.collectionName}${a.tokenId}`.localeCompare(
      `${b.collectionName}${b.tokenId}`,
    );
  });
}

function groupByCollection(nfts) {
  const groups = new Map();

  nfts.forEach((nft) => {
    const key = `${nft.chainId}:${nft.contract}`;
    if (!groups.has(key)) {
      groups.set(key, {
        chainId: nft.chainId,
        chainName: nft.chainName,
        contract: nft.contract,
        explorer: nft.explorer,
        collectionName: nft.collectionName,
        symbol: nft.symbol,
        color: nft.color,
        nfts: [],
      });
    }
    groups.get(key).nfts.push(nft);
  });

  return Array.from(groups.values()).sort((a, b) => {
    if (a.chainName !== b.chainName) return a.chainName.localeCompare(b.chainName);
    return a.collectionName.localeCompare(b.collectionName);
  });
}

function renderCollections() {
  const query = elements.resultSearch.value.trim().toLowerCase();
  const filteredNfts = state.nfts.filter((nft) => {
    const text = [
      nft.name,
      nft.collectionName,
      nft.symbol,
      nft.chainName,
      nft.contract,
      nft.tokenId,
    ]
      .join(" ")
      .toLowerCase();
    return text.includes(query);
  });

  const collections = groupByCollection(filteredNfts);
  const fragment = document.createDocumentFragment();

  collections.forEach((collection) => {
    const clone = elements.collectionTemplate.content.cloneNode(true);
    const card = clone.querySelector(".collection-card");
    const logo = clone.querySelector(".collection-logo");
    const name = clone.querySelector(".collection-name");
    const meta = clone.querySelector(".collection-meta");
    const link = clone.querySelector(".explorer-link");
    const grid = clone.querySelector(".nft-grid");

    logo.style.setProperty("--chain-color", collection.color || colorFromString(collection.collectionName));
    logo.textContent = initials(collection.symbol || collection.collectionName);
    name.textContent = collection.collectionName;
    meta.textContent = `${collection.chainName} · ${collection.nfts.length} item${collection.nfts.length === 1 ? "" : "s"}`;
    link.href = `${collection.explorer}/token/${collection.contract}`;

    collection.nfts.forEach((nft) => {
      const nftClone = elements.nftTemplate.content.cloneNode(true);
      const nftCard = nftClone.querySelector(".nft-card");
      const img = nftClone.querySelector("img");
      const fallback = nftClone.querySelector(".nft-fallback");
      const nftName = nftClone.querySelector(".nft-name");
      const tokenId = nftClone.querySelector(".nft-token-id");

      nftName.textContent = nft.name;
      tokenId.textContent = nft.tokenId ? `#${nft.tokenId}` : nft.type;

      if (nft.imageUrl) {
        img.src = proxyImage(nft.imageUrl);
        img.alt = nft.name;
        img.onload = () => fallback.classList.add("hidden");
        img.onerror = () => {
          img.classList.add("hidden");
          fallback.classList.remove("hidden");
        };
      } else {
        img.classList.add("hidden");
      }

      nftCard.title = `${nft.name} #${nft.tokenId}`;
      nftCard.addEventListener("click", () => {
        window.open(`${nft.explorer}/token/${nft.contract}/instance/${nft.tokenId}`, "_blank", "noopener,noreferrer");
      });

      grid.appendChild(nftClone);
    });

    fragment.appendChild(card);
  });

  elements.collectionGroups.replaceChildren(fragment);
  elements.emptyState.hidden = collections.length > 0 || state.isScanning;
  updateSummary();
}

function updateSummary() {
  const collections = groupByCollection(state.nfts);
  const chainIds = new Set(state.nfts.map((nft) => nft.chainId));
  const contracts = new Set(state.nfts.map((nft) => nft.contract));
  const totalNfts = state.nfts.length;

  elements.nftCount.textContent = totalNfts;
  elements.collectionCount.textContent = `${collections.length} collection${collections.length === 1 ? "" : "s"}`;
  elements.metricCollections.textContent = collections.length;
  elements.metricItems.textContent = totalNfts;
  elements.metricChains.textContent = chainIds.size;
  elements.metricContracts.textContent = contracts.size;

  const meterValue = Math.min(360, Math.max(0, totalNfts * 2));
  elements.radialMeter.style.setProperty("--meter-value", `${meterValue}deg`);
}

function addLog(scope, message, type = "info") {
  state.logs.unshift({
    scope,
    message,
    type,
    time: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  });
  state.logs = state.logs.slice(0, 120);
  renderLog();
}

function renderLog() {
  if (state.logs.length === 0) {
    elements.logList.innerHTML = '<p class="muted-line">No chain activity yet.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  state.logs.forEach((entry) => {
    const item = document.createElement("div");
    item.className = `log-entry ${entry.type}`;
    item.innerHTML = `<strong>${escapeHtml(entry.scope)}</strong><span>${escapeHtml(entry.message)} <small>${escapeHtml(entry.time)}</small></span>`;
    fragment.appendChild(item);
  });
  elements.logList.replaceChildren(fragment);
}

function setLoading(isLoading) {
  elements.scanButton.disabled = isLoading;
  elements.progressWrap.hidden = !isLoading && state.nfts.length === 0;
  elements.networkStatus.textContent = isLoading ? "Scanning" : "Idle";
}

function updateStatus(status) {
  elements.networkStatus.textContent = status;
}

function updateProgress(percent, text) {
  elements.progressWrap.hidden = false;
  elements.progressBanana.style.left = `${Math.min(100, Math.max(0, percent))}%`;
  elements.progressText.textContent = text;
}

function exportJson() {
  if (state.nfts.length === 0) {
    addLog("Export", "No NFTs to export", "error");
    return;
  }

  downloadFile(
    `nft-dashboard-${Date.now()}.json`,
    JSON.stringify(
      {
        scannedAt: new Date().toISOString(),
        wallet: elements.walletAddress.value.trim(),
        chainsScanned: state.scannedChains,
        nfts: state.nfts,
      },
      null,
      2,
    ),
    "application/json",
  );
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  addLog("Export", `${filename} downloaded`, "success");
}

function proxyImage(url) {
  if (url.startsWith("ipfs://")) {
    return url.replace("ipfs://", "https://ipfs.io/ipfs/");
  }
  if (url.startsWith("ar://")) {
    return url.replace("ar://", "https://arweave.net/");
  }
  return url;
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function normalizeAddress(value) {
  if (!value || !isAddress(value)) return "";
  return value.toLowerCase();
}

function normalizeExplorerUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeTokenType(type) {
  const clean = String(type || "").toUpperCase();
  if (clean.includes("721")) return "ERC-721";
  if (clean.includes("1155")) return "ERC-1155";
  return "ERC-20";
}

function toBigInt(value) {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
}

function colorFromString(value) {
  let hash = 0;
  const text = String(value || "NFT");
  for (let index = 0; index < text.length; index += 1) {
    hash = text.charCodeAt(index) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 68% 58%)`;
}

function cleanChainName(name) {
  return String(name || "EVM")
    .replace(/\s+Mainnet$/i, "")
    .replace(/\s+Network$/i, "")
    .trim();
}

function initials(value) {
  const clean = String(value || "N")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || "N";
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
