import Decimal from 'decimal.js';
import { InventoryTracker, Venue } from '../../src/inventory/tracker';

describe('InventoryTracker', () => {
    const eth = new Decimal('10');
    const usdt = new Decimal('10000');

    const makeTracker = () => {
        const tracker = new InventoryTracker([Venue.BINANCE, Venue.WALLET]);
        tracker.updateFromCex(Venue.BINANCE, {
            ETH: { free: eth, locked: new Decimal(0) },
            USDT: { free: usdt, locked: new Decimal(0) },
        });
        tracker.updateFromWallet(Venue.WALLET, {
            ETH: new Decimal('10'),
            USDT: new Decimal('5000'),
        });
        return tracker;
    };

    test('snapshot_aggregates_across_venues', () => {
        const tracker = makeTracker();
        const snap = tracker.snapshot();
        expect(snap.totals.ETH.toString()).toBe(new Decimal('20').toString());
        expect(snap.totals.USDT.toString()).toBe(new Decimal('15000').toString());
        expect(Object.keys(snap.venues)).toEqual(
            expect.arrayContaining([Venue.BINANCE, Venue.WALLET]),
        );
    });

    test('can_execute_passes_when_sufficient', () => {
        const tracker = makeTracker();
        const res = tracker.canExecute(
            Venue.BINANCE,
            'USDT',
            new Decimal('1000'),
            Venue.WALLET,
            'ETH',
            new Decimal('1'),
        );
        expect(res.canExecute).toBe(true);
        expect(res.reason).toBeNull();
    });

    test('can_execute_fails_insufficient_buy', () => {
        const tracker = makeTracker();
        const res = tracker.canExecute(
            Venue.BINANCE,
            'USDT',
            new Decimal('20000'),
            Venue.WALLET,
            'ETH',
            new Decimal('1'),
        );
        expect(res.canExecute).toBe(false);
        expect(res.reason).toBe('insufficientBuyBalance');
    });

    test('can_execute_fails_insufficient_sell', () => {
        const tracker = makeTracker();
        const res = tracker.canExecute(
            Venue.BINANCE,
            'USDT',
            new Decimal('1000'),
            Venue.WALLET,
            'ETH',
            new Decimal('50'),
        );
        expect(res.canExecute).toBe(false);
        expect(res.reason).toBe('insufficientSellBalance');
    });

    test('record_trade_updates_balances', () => {
        const tracker = makeTracker();
        tracker.recordTrade(
            Venue.BINANCE,
            'buy',
            'ETH',
            'USDT',
            new Decimal('1'),
            new Decimal('2000'),
            new Decimal('10'),
            'USDT',
        );
        expect(tracker.getAvailable(Venue.BINANCE, 'ETH').toString()).toBe(
            new Decimal('11').toString(),
        );
        expect(tracker.getAvailable(Venue.BINANCE, 'USDT').toString()).toBe(
            new Decimal('7990').toString(),
        );
    });

    test('skew_detects_imbalance', () => {
        const tracker = new InventoryTracker([Venue.BINANCE, Venue.WALLET]);
        tracker.updateFromCex(Venue.BINANCE, {
            ETH: { free: new Decimal('16'), locked: new Decimal(0) },
        });
        tracker.updateFromWallet(Venue.WALLET, { ETH: new Decimal('4') });
        const res = tracker.skew('ETH');
        expect(res.maxDeviationPct).toBeGreaterThanOrEqual(30);
        expect(res.needsRebalance).toBe(true);
    });

    test('skew_balanced', () => {
        const tracker = new InventoryTracker([Venue.BINANCE, Venue.WALLET]);
        tracker.updateFromCex(Venue.BINANCE, {
            ETH: { free: new Decimal('10'), locked: new Decimal(0) },
        });
        tracker.updateFromWallet(Venue.WALLET, { ETH: new Decimal('10') });
        const res = tracker.skew('ETH');
        expect(res.maxDeviationPct).toBeCloseTo(0);
        expect(res.needsRebalance).toBe(false);
    });
});
