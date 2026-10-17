# FundFlow Local Test Starter

This package provides one consistent UI and local Hardhat integration for the FundFlow contract. It is intended for development and classroom/demo use only. It does not configure any public blockchain.

## Requirements

- Node.js 22.x recommended
- npm
- Windows PowerShell or another terminal

## 1. Install dependencies

Open a terminal in the project root:

```powershell
npm install
```

## 2. Compile and run contract tests

```powershell
npm run compile
npm test
```

The active automated tests are in `test/FundFlow.test.ts`. The earlier empty `tests/FundFlow_test.sol` path is not the default test path for this Hardhat 2 configuration.

## 3. Start the local blockchain

In terminal 1:

```powershell
npm run node
```

Keep this terminal open. It should show local JSON-RPC at `http://127.0.0.1:8545` and chain ID `31337`. The account private keys printed by Hardhat are public demo credentials. Never fund or reuse them on a public network.

## 4. Start the UI and local bridge

In terminal 2, at the project root:

```powershell
npm run app
```

Open `http://127.0.0.1:5500`. Do not open the HTML via `file:///` and do not use a public RPC.

The local server binds to `127.0.0.1` only. Browser requests go to the local bridge, which talks to the Hardhat node. The UI does not need MetaMask, and it does not receive private keys.

## 5. Run the demo

Click **Run Full Demo**. The local server deploys a new FundFlow contract, registers a demo Member, Treasurer and Adviser, funds the contract with 10 test ETH, then executes and verifies examples of:

- a small request approved and released by the Treasurer;
- a large request approved by both Treasurer and Adviser, then released;
- a rejected request with a reason;
- a cancelled pending request.

All these are real transactions on your local test chain. The demo does not reset the node or erase previous deployments; it deploys a fresh contract and updates the active deployment record.

## Optional manual deploy

With the local node running:

```powershell
npm run compile
npm run deploy:local
```

Then click **Load saved deployment** in Local setup.

## Groq AI later

A `.env.example` is included for future server-side Groq setup. Copy it to `.env` and add your key when you are ready. The AI endpoint is not implemented or enabled in this starter, so no AI key is needed now.

```env
GROQ_API_KEY=your_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

Never place the Groq API key in `frontend/app.js`, `frontend/index.html`, or any browser-exposed variable. Keep `.env` private and do not commit it.

## Important contract note

The supplied FundFlow logic was retained with a targeted permission correction: `Admin` is reserved for the deploying contract owner. `addMember` and `updateMemberRole` therefore only accept Member, Treasurer or Adviser roles. Review the contract and tests before using any real deployment; this package is intentionally local-only.
