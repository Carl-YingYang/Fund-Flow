FUNDFLOW DUAL TRANSACTION MODE FIX

Replace only this file:
  C:\FundFlow\frontend\metamask-local.js

No installer script is included.

Steps:
1) Stop the app server with Ctrl+C; keep the Hardhat node terminal running.
2) Back up the existing file:
   Copy-Item "C:\FundFlow\frontend\metamask-local.js" "C:\FundFlow\frontend\metamask-local.js.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
3) Copy this folder's metamask-local.js over C:\FundFlow\frontend\metamask-local.js.
4) Restart the app: cd C:\FundFlow ; npm run app
5) Hard-refresh http://127.0.0.1:5500 with Ctrl+F5.

Modes:
- Demo accounts · local: the account selector can change between local Hardhat demo accounts while MetaMask may remain connected. Local demo transactions use the local Hardhat RPC signers, not MetaMask.
- MetaMask signer: MetaMask's active account signs transactions. The UI account selector is intentionally locked to that account; switch the active wallet account inside MetaMask.

Use Hardhat test keys only on local Hardhat chain ID 31337, never on public networks or real-fund wallets.
