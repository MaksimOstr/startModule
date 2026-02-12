import { Signal } from '../../src/strategy/signal';
import { SignalScorer, InventorySkew } from '../../src/strategy/scorer';
import { Direction } from '../../src/strategy/signal';

const makeSignal = (
    overrides: Partial<ConstructorParameters<typeof Signal>[0]> & { pair?: string },
) =>
    new Signal({
        pair: overrides.pair ?? 'ETH/USDT',
        direction: Direction.BUY_CEX_SELL_DEX,
        cexPrice: 100,
        dexPrice: 99,
        spreadBps: 100,
        size: 1,
        expectedGrossPnl: 10,
        expectedFees: 1,
        expectedNetPnl: 9,
        score: 80,
        expiry: Date.now() / 1000 + 60,
        inventoryOk: true,
        withinLimits: true,
        ...overrides,
    });

describe('SignalScorer', () => {
    test('returns high score when spread is excellent', () => {
        const scorer = new SignalScorer();
        const signal = makeSignal({ spreadBps: 100 });
        const score = scorer.score(signal, []);

        expect(score).toBeGreaterThanOrEqual(75);
        expect(score).toBeLessThanOrEqual(100);
    });

    test('applies inventory penalty when skew is RED', () => {
        const scorer = new SignalScorer();
        const signal = makeSignal({ spreadBps: 100 });
        const skew: InventorySkew[] = [{ token: 'ETH', status: 'RED' }];

        const penalized = scorer.score(signal, skew);
        const normal = scorer.score(signal, []);

        expect(penalized).toBeLessThan(normal);
    });

    test('decays score over time', () => {
        const fixedNow = Date.now();
        jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

        const timestamp = fixedNow / 1000 - 5;
        const expiry = timestamp + 10;
        const signal = makeSignal({ score: 80, expiry, timestamp });

        const scorer = new SignalScorer();
        const decayed = scorer.applyDecay(signal);

        expect(decayed).toBeCloseTo(60, 1);
    });
});
