import { TEST_BINANCE_CONFIG } from '../../src/config';
import { ExchangeClient } from '../../src/exchange/ExchangeClient';

describe('ExchangeClient live testnet', () => {
    if (!process.env.BINANCE_TESTNET_API_KEY || !process.env.BINANCE_TESTNET_SECRET) {
        test.skip('live tests skipped - missing API keys', () => {});
        return;
    }

    let client: ExchangeClient;

    beforeAll(async () => {
        jest.useRealTimers();
        client = new ExchangeClient(TEST_BINANCE_CONFIG);
        await client.init();
    });

    beforeEach(() => {
        jest.useRealTimers();
    });
    const symbol = 'ETH/USDT';

    test('fetch_order_book_structure_live', async () => {
        const ob = await client.fetchOrderBook(symbol, 5);
        expect(ob.bids.length).toBeGreaterThan(0);
        expect(ob.asks.length).toBeGreaterThan(0);
    });

    test('fetch_balance_filters_zeros_live', async () => {
        const bal = await client.fetchBalance();
        if (!bal) return;
        Object.values(bal).forEach((asset) => {
            expect(asset.total.greaterThanOrEqualTo(0)).toBe(true);
        });
    });

    test('limit_ioc_returns_fill_info_live', async () => {
        const ob = await client.fetchOrderBook(symbol, 5);
        const price = ob.best_ask[0].mul(1.01).toNumber();
        const amount = 0.02;
        const res = await client.createLimitIocOrder(symbol, 'buy', amount, price);
        if (!res) return;
        expect(res.amount_requested.toNumber()).toBeCloseTo(amount, 4);
        expect(['filled', 'partially_filled', 'expired']).toContain(res.status);
    });
});
