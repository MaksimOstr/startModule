import Decimal from 'decimal.js';
import { CircuitBreaker, ReplayProtection } from '../../src/executor/recovery';
import { Signal, Direction } from '../../src/strategy/signal';

const makeSignal = (id: string) =>
    new Signal({
        signalId: id,
        pair: 'ETH/USDT',
        direction: Direction.BUY_CEX_SELL_DEX,
        cexPrice: new Decimal(100),
        dexPrice: new Decimal(99),
        spreadBps: 50,
        size: new Decimal(1),
        expectedGrossPnl: new Decimal(1),
        expectedFees: new Decimal(0.1),
        expectedNetPnl: new Decimal(0.9),
        score: 10,
        expiry: Date.now() / 1000 + 60,
        inventoryOk: true,
        withinLimits: true,
    });

describe('CircuitBreaker', () => {
    test('trips after threshold failures', () => {
        const cb = new CircuitBreaker({
            failureThreshold: 3,
            windowSeconds: 300,
            cooldownSeconds: 600,
        });
        cb.recordFailure();
        cb.recordFailure();
        expect(cb.isOpen()).toBe(false);
        cb.recordFailure();
        expect(cb.isOpen()).toBe(true);
    });

    test('resets after cooldown', () => {
        const cb = new CircuitBreaker({
            failureThreshold: 1,
            windowSeconds: 300,
            cooldownSeconds: 1,
        });
        cb.recordFailure();
        expect(cb.isOpen()).toBe(true);

        const originalNow = Date.now;
        jest.spyOn(Date, 'now').mockImplementation(() => originalNow() + 2000);

        expect(cb.isOpen()).toBe(false);
    });
});

describe('ReplayProtection', () => {
    test('blocks duplicate signal_id', () => {
        const rp = new ReplayProtection(60);
        const s = makeSignal('sig-1');
        expect(rp.isDuplicate(s)).toBe(false);
        rp.markExecuted(s);
        expect(rp.isDuplicate(s)).toBe(true);
    });

    test('allows different signal_id', () => {
        const rp = new ReplayProtection(60);
        const s1 = makeSignal('sig-1');
        const s2 = makeSignal('sig-2');
        rp.markExecuted(s1);
        expect(rp.isDuplicate(s2)).toBe(false);
    });
});
