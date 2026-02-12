import Decimal from 'decimal.js';
import { SignalGenerator } from '../../src/strategy/generator';
import { Direction, Signal } from '../../src/strategy/signal';
import { FeeStructure } from '../../src/strategy/fees';
import { ExchangeClient } from '../../src/exchange/ExchangeClient';
import { PricingEngine, Quote } from '../../src/pricing/PricingEngine';
import { InventoryTracker, Venue } from '../../src/inventory/tracker';
import { Route } from '../../src/pricing/Route';

const dummyRoute = new Route([], []);
const makeQuote = (out: bigint) => new Quote(dummyRoute, 0n, out, out, 100_000n, Date.now() / 1000);

describe('SignalGenerator.generate', () => {
    const fees = new FeeStructure(10, 30, 5);

    let exchangeClient: jest.Mocked<ExchangeClient>;
    let pricingEngine: jest.Mocked<PricingEngine>;
    let inventory: jest.Mocked<InventoryTracker>;
    let generator: SignalGenerator;

    beforeEach(() => {
        jest.resetAllMocks();

        exchangeClient = {
            fetchOrderBook: jest.fn(),
        } as unknown as jest.Mocked<ExchangeClient>;

        pricingEngine = {
            fetchGasPriceGwei: jest.fn(),
            getQuote: jest.fn(),
        } as unknown as jest.Mocked<PricingEngine>;

        inventory = {
            getAvailable: jest.fn(),
        } as unknown as jest.Mocked<InventoryTracker>;

        generator = new SignalGenerator(exchangeClient, pricingEngine, inventory, fees, {
            cooldown_seconds: 0,
            min_profit_usd: 1,
        });
    });

    test('returns_signal_when_spread_covers_fees', async () => {
        exchangeClient.fetchOrderBook.mockResolvedValue({
            bids: [[new Decimal(100), new Decimal(10)]],
            asks: [[new Decimal(101), new Decimal(10)]],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        pricingEngine.fetchGasPriceGwei.mockResolvedValue(1n);
        pricingEngine.getQuote
            .mockResolvedValueOnce(makeQuote(575_000_000n))
            .mockResolvedValueOnce(makeQuote(5_050_000_000_000_000_000n));

        inventory.getAvailable.mockImplementation((venue, asset) => {
            if (venue === Venue.BINANCE && asset === 'USDT') return new Decimal(2000);
            if (venue === Venue.WALLET && asset === 'ETH') return new Decimal(10);
            return new Decimal(0);
        });

        const signal = await generator.generate('ETH/USDT', 5);

        expect(exchangeClient.fetchOrderBook).toHaveBeenCalledTimes(1);
        expect(pricingEngine.getQuote).toHaveBeenCalledTimes(2);
        expect(signal).toBeInstanceOf(Signal);
        expect(signal?.direction).toBe(Direction.BUY_CEX_SELL_DEX);
    });

    test('returns_null_when_spread_below_threshold', async () => {
        exchangeClient.fetchOrderBook.mockResolvedValue({
            bids: [[100, 10]],
            asks: [[101, 10]],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        pricingEngine.fetchGasPriceGwei.mockResolvedValue(1n);
        pricingEngine.getQuote
            .mockResolvedValueOnce(makeQuote(101_000_000n))
            .mockResolvedValueOnce(makeQuote(1_000_000_000_000_000_000n));

        inventory.getAvailable.mockReturnValue(new Decimal(10_000));

        const signal = await generator.generate('ETH/USDT', 1);

        expect(signal).toBeNull();
    });

    test('enforces_cooldown_between_signals', async () => {
        generator = new SignalGenerator(exchangeClient, pricingEngine, inventory, fees, {
            cooldown_seconds: 5,
            min_profit_usd: 1,
        });

        exchangeClient.fetchOrderBook.mockResolvedValue({
            bids: [[new Decimal(100), new Decimal(10)]],
            asks: [[new Decimal(101), new Decimal(10)]],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        pricingEngine.fetchGasPriceGwei.mockResolvedValue(1n);
        pricingEngine.getQuote
            .mockResolvedValueOnce(makeQuote(575_000_000n))
            .mockResolvedValueOnce(makeQuote(5_050_000_000_000_000_000n));
        inventory.getAvailable.mockReturnValue(new Decimal(10_000));

        const first = await generator.generate('ETH/USDT', 5);
        const second = await generator.generate('ETH/USDT', 5);

        expect(first).toBeInstanceOf(Signal);
        expect(second).toBeNull();
    });

    test('chooses_direction_with_higher_spread', async () => {
        exchangeClient.fetchOrderBook.mockResolvedValue({
            bids: [[new Decimal(100), new Decimal(10)]],
            asks: [[new Decimal(101), new Decimal(10)]],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        pricingEngine.fetchGasPriceGwei.mockResolvedValue(1n);
        pricingEngine.getQuote
            // sell base -> quote: price ~102 (smaller spreadA)
            .mockResolvedValueOnce(makeQuote(510_000_000n))
            // buy base for quote: price ~95 (bigger spreadB)
            .mockResolvedValueOnce(makeQuote(5_315_789_473_684_210_526n));
        inventory.getAvailable.mockReturnValue(new Decimal(10_000));

        const signal = await generator.generate('ETH/USDT', 5);

        expect(signal?.direction).toBe(Direction.BUY_DEX_SELL_CEX);
    });
});
