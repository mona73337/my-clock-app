# EVM NFT Dashboard

A dependency-free static EVM wallet NFT viewer with a dark interface and gold accent.

## Run

Open `index.html` in a browser, or serve the directory with any static file server.

## Data Source

The dashboard uses public Blockscout explorer APIs. When a wallet address is submitted, it loads the current Chainscout mainnet list and scans Blockscout-hosted EVM explorers for ERC-721 and ERC-1155 token balances.

## Notes

- No wallet connection or API key is required. Paste any 0x address and scan.
- NFT detection depends on each public explorer supporting the Blockscout `/api/v2/addresses/{address}/token-balances` endpoint and allowing browser requests.
- Public endpoints are rate-limited, so full all-chain scans can take a little time.
- Image previews use direct token metadata; broken or IPFS-only images fall back to a golden banana placeholder.
