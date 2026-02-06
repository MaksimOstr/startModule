import { configDotenv } from 'dotenv';
import Decimal from 'decimal.js';
import { BINANCE_CONFIG } from '../src/config';
import { ExchangeClient } from '../src/exchange/ExchangeClient';
import { InventoryTracker, Venue } from '../src/inventory/tracker';
import { ChainClient } from '../src/chain/ChainClient';
import { ArbChecker } from '../src/integration/arb_checker';

configDotenv();

const DEFAULT_RPCS = [
    'https://eth.llamarpc.com',
    'https://rpc.ankr.com/eth',
    'https://1rpc.io/eth',
];

type Args = { pair: string; size: Decimal };

function parseArgs(): Args {
    const [, , ...rest] = process.argv;
    if (!rest.length) {
        console.error('Usage: ts-node scripts/arb-checker-cli.ts <PAIR> [--size 2]');
        process.exit(1);
    }
    const pair = rest[0];
    let size = new Decimal(1);
    for (let i = 1; i < rest.length; i++) {
        if (rest[i] === '--size' || rest[i] === '-s') {
            size = new Decimal(rest[i + 1] ?? size);
            i++;
        }
    }
    return { pair, size };
}

function fmt(n: Decimal.Value, minFrac = 2, maxFrac = 2) {
    return new Decimal(n).toNumber().toLocaleString('en-US', {
        minimumFractionDigits: minFrac,
        maximumFractionDigits: maxFrac,
    });
}

function fmtInv(asset: string, value: Decimal.Value) {
    const d = new Decimal(value);
    const isUsd = asset.toUpperCase().includes('USD');
    const decimals = isUsd ? 0 : d.mod(1).eq(0) ? 0 : 1;
    return d.toNumber().toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

async function main() {
    const { pair, size } = parseArgs();

    if (!BINANCE_CONFIG.apiKey || !BINANCE_CONFIG.secret) {
        console.error('Missing BINANCE_TESTNET_API_KEY/BINANCE_TESTNET_SECRET in .env');
        process.exit(1);
    }

    const exchange = new ExchangeClient(BINANCE_CONFIG);
    await exchange.init();
    const tracker = new InventoryTracker([Venue.WALLET, Venue.BINANCE]);
    tracker.updateFromWallet(Venue.WALLET, {
        ETH: new Decimal('100'),
        USDT: new Decimal('200000'),
    });
    tracker.updateFromCex(Venue.BINANCE, {
        ETH: { free: new Decimal('100'), locked: new Decimal(0) },
        USDT: { free: new Decimal('200000'), locked: new Decimal(0) },
    });

    const chain = new ChainClient(DEFAULT_RPCS);

    const checker = new ArbChecker(chain, exchange, tracker);
    const res = await checker.check(pair, size);

    const dirLabel =
        res.direction === 'buy_dex_sell_cex'
            ? 'buy'
            : res.direction === 'buy_cex_sell_dex'
              ? 'sell'
              : 'n/a';
    const cexLabel = res.direction === 'buy_dex_sell_cex' ? 'bid' : 'ask';
    const costs = res.details;
    const inv = res.inventory_details;
    const pnlLabel = res.estimated_net_pnl_bps.greaterThan(0) ? 'PROFITABLE' : 'NOT PROFITABLE';
    const pnlSign = res.estimated_net_pnl_bps.greaterThan(0) ? '+' : '';
    const verdict = res.executable ? 'EXECUTE' : 'SKIP  costs exceed gap';

    console.log('');
    console.log(`  ARB CHECK: ${res.pair} (size: ${size.toString()} ETH)`);
    console.log('');
    console.log('Prices:');
    console.log(
        `  Uniswap V2:      ${fmt(res.dex_price, 2, 2)} (${dirLabel} ${size.toString()} ETH)`,
    );
    console.log(
        `  Binance ${cexLabel}:      ${fmt(cexLabel === 'bid' ? res.cex_bid : res.cex_ask, 2, 2)}`,
    );
    console.log('');
    console.log(
        `Gap: ${fmt(res.gap_bps.mul(res.dex_price).div(10000), 2, 2)} (${fmt(res.gap_bps, 1, 1)} bps)`,
    );
    console.log('');
    console.log('Costs:');
    console.log(`  DEX fee:           ${fmt(costs.dex_fee_bps, 1, 1)} bps`);
    console.log(`  DEX price impact:   ${fmt(costs.dex_price_impact_bps, 1, 1)} bps`);
    console.log(`  CEX fee:           ${fmt(costs.cex_fee_bps, 1, 1)} bps`);
    console.log(`  CEX slippage:       ${fmt(costs.cex_slippage_bps, 1, 1)} bps`);
    console.log(
        `  Gas:               ${fmt(costs.gas_cost_usd, 2, 2)} (${fmt(costs.gas_bps, 1, 1)} bps)`,
    );
    console.log('  ');
    console.log(`  Total costs:       ${fmt(res.estimated_costs_bps, 1, 1)} bps`);
    console.log('');
    console.log(
        `Net PnL estimate: ${fmt(res.estimated_net_pnl_bps, 1, 1)} bps ${pnlSign} ${pnlLabel}`,
    );
    console.log('');
    console.log('Inventory:');
    console.log(
        `  Wallet ${inv.wallet_asset}:  ${fmtInv(inv.wallet_asset, inv.wallet_bal)} (need ${fmtInv(inv.wallet_asset, inv.wallet_need)})`,
    );
    console.log(
        `  Binance ${inv.cex_asset}:   ${fmtInv(inv.cex_asset, inv.cex_bal)} (need ${fmtInv(inv.cex_asset, inv.cex_need)})`,
    );
    console.log('');
    console.log(`Verdict: ${verdict}`);
    console.log('');
}

main().catch((err) => {
    console.error('Arb checker failed', err);
    process.exit(1);
});
