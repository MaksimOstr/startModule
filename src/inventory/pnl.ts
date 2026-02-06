import Decimal from 'decimal.js';
import fs from 'fs';
import { Venue } from './tracker';

export type TradeLeg = {
    id: string;
    timestamp: Date;
    venue: Venue;
    symbol: string;
    side: 'buy' | 'sell';
    amount: Decimal;
    price: Decimal;
    fee: Decimal;
    feeAsset: string;
};

export class ArbRecord {
    id: string;
    timestamp: Date;
    buyLeg: TradeLeg;
    sellLeg: TradeLeg;
    gasCostUsd: Decimal;

    constructor(params: {
        id: string;
        timestamp: Date;
        buyLeg: TradeLeg;
        sellLeg: TradeLeg;
        gasCostUsd?: Decimal;
    }) {
        this.id = params.id;
        this.timestamp = params.timestamp;
        this.buyLeg = params.buyLeg;
        this.sellLeg = params.sellLeg;
        this.gasCostUsd = params.gasCostUsd ?? new Decimal(0);
    }

    get grossPnl(): Decimal {
        const sellRevenue = this.sellLeg.amount.mul(this.sellLeg.price);
        const buyCost = this.buyLeg.amount.mul(this.buyLeg.price);
        return sellRevenue.sub(buyCost);
    }

    get totalFees(): Decimal {
        return this.buyLeg.fee.add(this.sellLeg.fee).add(this.gasCostUsd);
    }

    get netPnl(): Decimal {
        return this.grossPnl.sub(this.totalFees);
    }

    get notional(): Decimal {
        return this.buyLeg.amount.mul(this.buyLeg.price);
    }

    get netPnlBps(): Decimal {
        if (this.notional.eq(0)) return new Decimal(0);
        return this.netPnl.div(this.notional).mul(10_000);
    }
}

export class PnLEngine {
    trades: ArbRecord[] = [];

    record(trade: ArbRecord) {
        this.trades.push(trade);
    }

    summary() {
        if (!this.trades.length) {
            return {
                totalTrades: 0,
                totalPnlUsd: new Decimal(0),
                totalFeesUsd: new Decimal(0),
                avgPnlPerTrade: new Decimal(0),
                avgPnlBps: new Decimal(0),
                winRate: 0,
                bestTradePnl: new Decimal(0),
                worstTradePnl: new Decimal(0),
                totalNotional: new Decimal(0),
                sharpeEstimate: 0,
                pnlByHour: {} as Record<number, Decimal>,
            };
        }

        const totalPnl = this.trades.reduce((s, t) => s.add(t.netPnl), new Decimal(0));
        const totalFees = this.trades.reduce((s, t) => s.add(t.totalFees), new Decimal(0));
        const totalNotional = this.trades.reduce((s, t) => s.add(t.notional), new Decimal(0));
        const winCount = this.trades.filter((t) => t.netPnl.gt(0)).length;
        const best = this.trades.reduce(
            (m, t) => (t.netPnl.gt(m) ? t.netPnl : m),
            this.trades[0].netPnl,
        );
        const worst = this.trades.reduce(
            (m, t) => (t.netPnl.lt(m) ? t.netPnl : m),
            this.trades[0].netPnl,
        );

        const pnls = this.trades.map((t) => t.netPnl);
        const pnlsBps = this.trades.map((t) => t.netPnlBps);
        const mean = totalPnl.div(this.trades.length);
        const variance = pnls
            .reduce((s, p) => s.add(p.sub(mean).pow(2)), new Decimal(0))
            .div(this.trades.length);
        const std = variance.sqrt();
        const sharpe = std.eq(0) ? 0 : mean.div(std).toNumber();

        const pnlByHour: Record<number, Decimal> = {};
        for (const t of this.trades) {
            const h = t.timestamp.getUTCHours();
            pnlByHour[h] = (pnlByHour[h] ?? new Decimal(0)).add(t.netPnl);
        }

        return {
            totalTrades: this.trades.length,
            totalPnlUsd: totalPnl,
            totalFeesUsd: totalFees,
            avgPnlPerTrade: totalPnl.div(this.trades.length),
            avgPnlBps: this.trades.length
                ? pnlsBps.reduce((s, t) => s.add(t), new Decimal(0)).div(this.trades.length)
                : new Decimal(0),
            winRate: (winCount / this.trades.length) * 100,
            bestTradePnl: best,
            worstTradePnl: worst,
            totalNotional,
            sharpeEstimate: sharpe,
            pnlByHour,
        };
    }

    recent(n = 10) {
        return this.trades
            .slice(-n)
            .map((t) => ({
                id: t.id,
                timestamp: t.timestamp,
                symbol: t.buyLeg.symbol,
                buyVenue: t.buyLeg.venue,
                sellVenue: t.sellLeg.venue,
                netPnl: t.netPnl,
                netPnlBps: t.netPnlBps,
            }))
            .reverse();
    }

    exportCsv(filepath: string) {
        const headers = [
            'id',
            'timestamp',
            'buy_venue',
            'sell_venue',
            'symbol',
            'buy_price',
            'sell_price',
            'amount',
            'gross_pnl',
            'net_pnl',
            'net_pnl_bps',
            'fees',
            'gas_cost',
        ];
        const rows = this.trades.map((t) => {
            return [
                t.id,
                t.timestamp.toISOString(),
                t.buyLeg.venue,
                t.sellLeg.venue,
                t.buyLeg.symbol,
                t.buyLeg.price.toString(),
                t.sellLeg.price.toString(),
                t.buyLeg.amount.toString(),
                t.grossPnl.toString(),
                t.netPnl.toString(),
                t.netPnlBps.toString(),
                t.totalFees.toString(),
                t.gasCostUsd.toString(),
            ].join(',');
        });
        const content = [headers.join(','), ...rows].join('\n');
        fs.writeFileSync(filepath, content, 'utf8');
    }
}
