## Trading system

## Project Structure

- ```core/``` : core logic and basic types.
   - ```WalletManager``` : class for secure and convenient wallet management
   - ```CanonicalSerializer``` : Deterministic JSON serializer.
- ```chain/``` - blockchain interaction classes
   - ```ChainClient``` - RPC client with methods for blockchain operations.
   - ```TransactionBuilder``` : A class for constructing and preparing transactions

## Quick start

1. Clone repository:
   ```
   git clone <repository_url>
   ```

2. Install dependencies:
   ```bash
   npm install
   ```
3. Create `.env` file in the root folder and set the environment variables specified in `.env.example`

4. Start application:
   ```bash
   npm run start
   ```

## Usage

 - Run integration test: 

   ```bash
   ts-node scripts/integration-test.ts
   ```

- Expected output:
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



## Features
 - Retry logic with exponential backoff was implemented in ```ChainClient``` to ensure reliable behaviour during RPC instability
 - ```TransactionBuilder``` - convenient builder for transactions.
 - ```WalletManager``` — a wallet wrapper for secure and convenient wallet management.
