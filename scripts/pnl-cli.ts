import Decimal from 'decimal.js';
import { ArbRecord, PnLEngine, TradeLeg } from '../src/inventory/pnl';
import { Venue } from '../src/inventory/tracker';

type Args = { summary: boolean };

function parseArgs(): Args {
    const flags = new Set(process.argv.slice(2));
    const summary = flags.has('--summary') || flags.size === 0;
    return { summary };
}

function seedEngine(): PnLEngine {
    const engine = new PnLEngine();
    const now = Date.now();

    const makeLegs = (
        baseId: string,
        buyVenue: Venue,
        sellVenue: Venue,
        buyPrice: string,
        sellPrice: string,
        amount: string,
        feeBuy: string,
        feeSell: string,
        offsetMin: number,
    ): { buy: TradeLeg; sell: TradeLeg } => {
        const tsBuy = new Date(now - offsetMin * 60_000 - 60_000);
        const tsSell = new Date(now - offsetMin * 60_000);
        const qty = new Decimal(amount);
        return {
            buy: {
                id: `${baseId}-buy`,
                timestamp: tsBuy,
                venue: buyVenue,
                symbol: 'ETH/USDT',
                side: 'buy',
                amount: qty,
                price: new Decimal(buyPrice),
                fee: new Decimal(feeBuy),
                feeAsset: 'USDT',
            },
            sell: {
                id: `${baseId}-sell`,
                timestamp: tsSell,
                venue: sellVenue,
                symbol: 'ETH/USDT',
                side: 'sell',
                amount: qty,
                price: new Decimal(sellPrice),
                fee: new Decimal(feeSell),
                feeAsset: 'USDT',
            },
        };
    };

    const legsList = [
        makeLegs('t1', Venue.WALLET, Venue.BINANCE, '2000', '2010', '1', '2', '1.5', 5),
        makeLegs('t2', Venue.WALLET, Venue.BINANCE, '2001', '2008', '0.8', '1.6', '1.3', 10),
        makeLegs('t3', Venue.BINANCE, Venue.WALLET, '2005', '2004', '1.2', '2.4', '1.8', 15),
        makeLegs('t4', Venue.WALLET, Venue.BINANCE, '1998', '2006', '1', '2', '1.5', 20),
        makeLegs('t5', Venue.BINANCE, Venue.WALLET, '2003', '2002', '0.9', '1.8', '1.4', 25),
    ];

    legsList.forEach((legs, idx) => {
        engine.record(
            new ArbRecord({
                id: `arb-${idx + 1}`,
                timestamp: legs.sell.timestamp,
                buyLeg: legs.buy,
                sellLeg: legs.sell,
                gasCostUsd: new Decimal('0.5'),
            }),
        );
    });
    return engine;
}

function fmtUsd(n: Decimal) {
    const num = n.toNumber();
    return `${num < 0 ? '-' : ''}$${Math.abs(num).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function fmtBps(n: Decimal) {
    return `${n.toNumber().toFixed(1)} bps`;
}

function renderSummary(engine: PnLEngine) {
    const s = engine.summary();
    console.log('PnL Summary (last 24h)\n');
    console.log(`Total Trades:        ${s.totalTrades}`);
    console.log(`Win Rate:            ${s.winRate.toFixed(1)}%`);
    console.log(`Total PnL:           ${fmtUsd(s.totalPnlUsd)}`);
    console.log(`Total Fees:          ${fmtUsd(s.totalFeesUsd)}`);
    console.log(`Avg PnL/Trade:       ${fmtUsd(s.avgPnlPerTrade)}`);
    console.log(`Avg PnL (bps):       ${fmtBps(s.avgPnlBps)}`);
    console.log(`Best Trade:          ${fmtUsd(s.bestTradePnl)}`);
    console.log(`Worst Trade:         ${fmtUsd(s.worstTradePnl)}`);
    console.log(`Total Notional:      ${fmtUsd(s.totalNotional)}`);
    console.log('\nRecent Trades:');
    const recent = engine.recent(Math.min(5, s.totalTrades || 5));
    recent.forEach((t) => {
        const time = t.timestamp.toISOString().slice(11, 16);
        const side = `Buy ${cap(t.buyVenue)} / Sell ${cap(t.sellVenue)}`;
        const pnlStr = `${t.netPnl.gt(0) ? '+' : ''}${fmtUsd(t.netPnl)} (${fmtBps(t.netPnlBps)})`;
        console.log(`  ${time}  ${t.symbol.split('/')[0]}  ${side}  ${pnlStr}`);
    });
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function main() {
    const { summary } = parseArgs();
    const engine = seedEngine();
    if (summary) renderSummary(engine);
}

main();
