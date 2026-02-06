import Decimal from 'decimal.js';
import fs from 'fs';
import path from 'path';
import { ArbRecord, PnLEngine, TradeLeg } from '../../src/inventory/pnl';
import { Venue } from '../../src/inventory/tracker';

const makeTrade = (overrides?: Partial<ArbRecord>) => {
    const buyLeg: TradeLeg = {
        id: 'buy1',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        venue: Venue.BINANCE,
        symbol: 'ETH/USDT',
        side: 'buy',
        amount: new Decimal('1'),
        price: new Decimal('2000'),
        fee: new Decimal('2'),
        feeAsset: 'USDT',
    };
    const sellLeg: TradeLeg = {
        id: 'sell1',
        timestamp: new Date('2024-01-01T00:05:00Z'),
        venue: Venue.WALLET,
        symbol: 'ETH/USDT',
        side: 'sell',
        amount: new Decimal('1'),
        price: new Decimal('2010'),
        fee: new Decimal('1.5'),
        feeAsset: 'USDT',
    };
    return new ArbRecord({
        id: 'arb1',
        timestamp: new Date('2024-01-01T00:05:00Z'),
        buyLeg,
        sellLeg,
        gasCostUsd: new Decimal('0.5'),
        ...overrides,
    });
};

describe('PnLEngine', () => {
    test('gross_pnl_calculation', () => {
        const trade = makeTrade();
        expect(trade.grossPnl.toString()).toBe(new Decimal('10').toString());
    });

    test('net_pnl_includes_all_fees', () => {
        const trade = makeTrade();
        const expected = trade.grossPnl
            .sub(trade.buyLeg.fee)
            .sub(trade.sellLeg.fee)
            .sub(trade.gasCostUsd);
        expect(trade.netPnl.toString()).toBe(expected.toString());
    });

    test('pnl_bps_calculation', () => {
        const trade = makeTrade();
        const expected = trade.netPnl.div(trade.notional).mul(10_000);
        expect(trade.netPnlBps.toString()).toBe(expected.toString());
    });

    test('summary_win_rate', () => {
        const engine = new PnLEngine();
        engine.record(makeTrade({ id: 'win' }));
        engine.record(
            makeTrade({
                id: 'loss',
                sellLeg: { ...makeTrade().sellLeg, price: new Decimal('1990') },
            }),
        );
        const summary = engine.summary();
        expect(summary.winRate).toBeCloseTo(50);
    });

    test('summary_with_no_trades', () => {
        const engine = new PnLEngine();
        const summary = engine.summary();
        expect(summary.totalTrades).toBe(0);
        expect(summary.totalPnlUsd.toNumber()).toBe(0);
    });

    test('export_csv_format', () => {
        const engine = new PnLEngine();
        engine.record(makeTrade());
        const tmp = path.join(process.cwd(), 'tmp_pnl.csv');
        engine.exportCsv(tmp);
        const csv = fs.readFileSync(tmp, 'utf8').trim().split('\n');
        expect(csv[0]).toContain('id,timestamp,buy_venue,sell_venue');
        expect(csv[1]).toContain('arb1');
        fs.unlinkSync(tmp);
    });
});
