# Trading System

## Project Structure

```
core/      # core logic and basic types
chain/     # blockchain interaction classes
pricing/   # classes for blockchain price analysis
```

### core/

* **WalletManager** : class for secure and convenient wallet management
* **CanonicalSerializer** : Deterministic JSON serializer

### chain/

* **ChainClient** : RPC client with methods for blockchain operations
* **TransactionBuilder** : A class for constructing and preparing transactions
* **TransactionAnalyzer**: transaction analysis tool

### pricing/
* **ForkSimulator**: blockchain interaction simulator
* **MempoolMonitor**: monitoring pending transaction in real time
* **PriceImpactAnalyzer**: price pool analyzer
* **PricingEngine**: Orchestrator for routing, pool monitoring and fork simulation
* **RouterFinder**: class which handle token routing and output optimization considering gas costs
* **UniswapV2Pair**: AMM (Uniswap V2)


## Quick Start

### 1. Clone repository

```
git clone <repository_url>
```

### 2. Install dependencies

```bash
npm install
```

### 3. Environment setup

Create a `.env` file in the root folder and set the environment variables specified in `.env.example`

### 4. Start application

```bash
npm run start
```

---

## Usage

### Run integration test

```bash
ts-node scripts/integration-test.ts
```

#### Expected output

```
================ INTEGRATION TEST =================
Wallet Address:        0xC7Ff5013Db67Ed46E5fa87eEc79127496838FdE9
[ChainClient] [getBalance] succeeded in 651ms (attempt 1)
Balance:               0.049341098022665 ETH
[ChainClient] [getNonce] succeeded in 152ms (attempt 1)
Transaction Nonce:     25
[ChainClient] [estimateGas] succeeded in 161ms (attempt 1)
[ChainClient] [getGasPrice] succeeded in 291ms (attempt 1)
Estimated Gas Limit:   64551
Max Fee Per Gas:       4434426528
Max Priority Fee:      1439189
Recovered Signer:      0xC7Ff5013Db67Ed46E5fa87eEc79127496838FdE9
Signature Valid:       YES
---------------- Sending Transaction ----------------
[ChainClient] [sendTransaction] succeeded in 158ms (attempt 1)
Transaction Hash:      0xcd32b62569f627dbccdd1ccab24bb09a067d774dabcf7cfe94fba61cc55f364e
[ChainClient] Start waiting for receipt: 0xcd32b62569f627dbccdd1ccab24bb09a067d774dabcf7cfe94fba61cc55f364e, timeout=120s
[ChainClient] Receipt received for 0xcd32b62569f627dbccdd1ccab24bb09a067d774dabcf7cfe94fba61cc55f364e after 8136 ms
================ Transaction Receipt =================
Block Number:          10106313
Gas Used:              21000
Effective Gas Price:   1850224515
Transaction Fee:       0.000038854714815 ETH
Logs Count:            0
=======================================================
```

---

### Run transaction analyzer

```bash
ts-node .\src\chain\TransactionAnalyzer.ts <txHash>
```

#### Expected output

```
Transaction Analysis
====================
Hash:           0x3e5ecdfeba7c8532ea10c4ef6e99f83745117ed6dbe9e587eeaae52d45ef9973
Block:          10107427
Timestamp:      Fri, 23 Jan 2026 17:23:36 GMT
Status:         SUCCESS

From:           0xC7Ff5013Db67Ed46E5fa87eEc79127496838FdE9
To:             0xC7Ff5013Db67Ed46E5fa87eEc79127496838FdE9
Value:          0.0001 ETH

Gas Analysis
------------
Gas Limit:       64551
Gas Used:        21000 (32.53%)
Base Fee:        0.986218306 gwei
Priority Fee:    0.001439189 gwei
Effective Price: 0.987657495 gwei
Transaction Fee: 0.000020740807395 ETH

Function Called
---------------
Native ETH Transfer

Token Transfers
---------------
No ERC-20 transfers found

Swap Summary
------------
Sold:      0.0001 ETH (Native)
```

---

### Run price analyzer

```bash
ts-node scripts/price-analyzer-cli.ts 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 --token-in USDC --sizes 1000,10000,100000, 1000000
```

#### Expected output
```
Price Impact Analysis for USDC -> ETH
Pool: 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720
Reserves: 2 000 000 USDC / 1 000 ETH
Spot Price: 0,001 ETH per USDC

┌───────────┬────────────┬────────────┬────────┐
│   USDC In │    ETH Out │ Exec Price │ Impact │
├───────────┼────────────┼────────────┼────────┤
│     1 000 │   0,498252 │   2 007,02 │  0.35% │
├───────────┼────────────┼────────────┼────────┤
│    10 000 │   4,960273 │   2 016,02 │  0.79% │
├───────────┼────────────┼────────────┼────────┤
│   100 000 │  47,482974 │   2 106,02 │  5.03% │
├───────────┼────────────┼────────────┼────────┤
│ 1 000 000 │ 332,665999 │   3 006,02 │ 33.47% │
└───────────┴────────────┴────────────┴────────┘

Max trade for 1% impact: 14 183,966 USDC

```

## Features

* Retry logic with exponential backoff was implemented in **ChainClient** to ensure reliable behaviour during RPC instability
* **TransactionBuilder** : convenient builder for transactions
* **WalletManager** : a wallet wrapper for secure and convenient wallet management
* Multi hop routing optimizations for better output considering gas costs
* Trade simulation to choose optimal trading strategy.
