import Decimal from 'decimal.js';
import { BINANCE_CONFIG } from '../src/config';
import { ExchangeClient } from '../src/exchange/ExchangeClient';
import { OrderBookAnalyzer } from '../src/exchange/OrderBookAnalyzer';

type CliOpts = {
    symbol: string;
    depth: number;
    walk: number[];
};

function parseArgs(): CliOpts {
    const [, , ...rest] = process.argv;
    if (!rest.length) {
        console.error('Usage: ts-node scripts/orderbook-cli.ts <SYMBOL> [--depth N] [--walk 1,5]');
        process.exit(1);
    }

    const symbol = rest[0];
    let depth = 20;
    let walk: number[] = [2, 10];

    for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === '--depth' || arg === '-d') {
            depth = Number(rest[i + 1] ?? depth);
            i++;
        } else if (arg === '--walk') {
            walk = (rest[i + 1] ?? '')
                .split(',')
                .map((v) => Number(v.trim()))
                .filter((v) => !Number.isNaN(v) && v > 0);
            if (!walk.length) walk = [2, 10];
            i++;
        }
    }

    return { symbol, depth, walk };
}

function fmtUsd(n: Decimal.Value, minFrac = 2, maxFrac = 2) {
    return `$${new Decimal(n).toNumber().toLocaleString('en-US', {
        minimumFractionDigits: minFrac,
        maximumFractionDigits: maxFrac,
    })}`;
}

function fmtNum(n: Decimal.Value, minFrac = 2, maxFrac = 2) {
    return `${new Decimal(n).toNumber().toLocaleString('en-US', {
        minimumFractionDigits: minFrac,
        maximumFractionDigits: maxFrac,
    })}`;
}

function pad(label: string, value: string, width = 14) {
    return `${label.padEnd(width)}${value}`;
}

async function main() {
    const { symbol, depth, walk } = parseArgs();

    if (!process.env.BINANCE_TESTNET_API_KEY || !process.env.BINANCE_TESTNET_SECRET) {
        console.error('Missing BINANCE_TESTNET_API_KEY/BINANCE_TESTNET_SECRET in environment/.env');
        process.exit(1);
    }

    const client = new ExchangeClient(BINANCE_CONFIG);
    await client.init();
    const ob = await client.fetchOrderBook(symbol, depth);
    const analyzer = new OrderBookAnalyzer(ob);

    const [bestBidPx, bestBidQty] = ob.best_bid;
    const [bestAskPx, bestAskQty] = ob.best_ask;
    const spread = bestAskPx.sub(bestBidPx);

    const depthBids = analyzer.depthAtBps('bid', 10);
    const depthAsks = analyzer.depthAtBps('ask', 10);
    const notionalBids = depthBids.mul(bestBidPx);
    const notionalAsks = depthAsks.mul(bestAskPx);

    const imbalance = analyzer.imbalance();

    console.log();
    console.log(`  ${symbol} Order Book Analysis`);
    console.log(
        `  Timestamp: ${new Date(ob.timestamp).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}`,
    );
    console.log();
    console.log(
        `  ${pad('Best Bid:', `${fmtUsd(bestBidPx)}  ${fmtNum(bestBidQty, 2, 4)} ${symbol.split('/')[0]}`)}`,
    );
    console.log(
        `  ${pad('Best Ask:', `${fmtUsd(bestAskPx)}  ${fmtNum(bestAskQty, 2, 4)} ${symbol.split('/')[0]}`)}`,
    );
    console.log(`  ${pad('Mid Price:', fmtUsd(ob.mid_price))}`);
    console.log(
        `  ${pad('Spread:', `${fmtUsd(spread, 2, 4)} (${fmtNum(ob.spread_bps, 2, 2)} bps)`)}`,
    );
    console.log();
    console.log('  Depth (within 10 bps):');
    console.log(
        `    Bids: ${fmtNum(depthBids, 2, 2)} ${symbol.split('/')[0]} (${fmtUsd(notionalBids)})`,
    );
    console.log(
        `    Asks: ${fmtNum(depthAsks, 2, 2)} ${symbol.split('/')[0]} (${fmtUsd(notionalAsks)})`,
    );
    const bias = imbalance > 0.1 ? 'buy pressure' : imbalance < -0.1 ? 'sell pressure' : 'balanced';
    console.log(`  Imbalance: ${imbalance >= 0 ? '+' : ''}${fmtNum(imbalance, 2, 2)} (${bias})`);
    console.log();

    for (const qty of walk) {
        const res = analyzer.walkTheBook('buy', qty);
        console.log(`  Walk-the-book (${qty} ${symbol.split('/')[0]} buy):`);
        console.log(`    Avg price:  ${fmtUsd(res.avg_price, 2, 5)}`);
        console.log(`    Slippage:   ${fmtNum(res.slippage_bps, 2, 3)} bps`);
        console.log(`    Levels:     ${res.levels_consumed}`);
    }

    const eff = analyzer.effectiveSpread(walk[0] ?? 1);
    console.log();
    console.log(
        `  Effective spread (${walk[0] ?? 1} ${symbol.split('/')[0]} round-trip): ${fmtNum(eff, 2, 3)} bps`,
    );
    console.log();
}

main().catch((err) => {
    console.error('Failed to run order book analysis', err);
    process.exit(1);
});
