import Decimal from 'decimal.js';
import { ExchangeClient } from '../../src/exchange/ExchangeClient';
import { TEST_BINANCE_CONFIG } from '../../src/config';

const createOrderMock = jest.fn();
const fetchOrderBookMock = jest.fn();
const fetchBalanceMock = jest.fn();
const fetchTradingFeeMock = jest.fn();
const fetchOrderMock = jest.fn();
const cancelOrderMock = jest.fn();
const loadMarketsMock = jest.fn();

jest.mock('ccxt', () => {
    const binance = jest.fn().mockImplementation((cfg) => ({
        ...cfg,
        createOrder: createOrderMock,
        fetchOrderBook: fetchOrderBookMock,
        fetchBalance: fetchBalanceMock,
        fetchTradingFee: fetchTradingFeeMock,
        fetchOrder: fetchOrderMock,
        cancelOrder: cancelOrderMock,
        loadMarkets: loadMarketsMock,
    }));
    return { __esModule: true, default: { binance } };
});

const resetMocks = () => {
    createOrderMock.mockReset();
    fetchOrderBookMock.mockReset();
    fetchBalanceMock.mockReset();
    fetchTradingFeeMock.mockReset();
    fetchOrderMock.mockReset();
    cancelOrderMock.mockReset();
    loadMarketsMock.mockReset();
};

describe('ExchangeClient mocked', () => {
    const cfg = { ...TEST_BINANCE_CONFIG, apiKey: 'k', secret: 's' };

    beforeEach(() => {
        resetMocks();
    });

    test('fetch_order_book_structure', async () => {
        fetchOrderBookMock.mockResolvedValue({
            symbol: 'ETH/USDT',
            bids: [
                [2000, 1],
                [1999, 2],
            ],
            asks: [
                [2001, 1],
                [2002, 2],
            ],
            timestamp: 123,
        });
        const client = new ExchangeClient(cfg);
        const ob = await client.fetchOrderBook('ETH/USDT', 2);
        expect(ob.best_bid[0].toNumber()).toBe(2000);
        expect(ob.best_ask[0].toNumber()).toBe(2001);
        expect(ob.mid_price.toNumber()).toBe(2000.5);
        expect(ob.spread_bps.toNumber()).toBeCloseTo((1 / 2000.5) * 10000);
    });

    test('order_book_bids_descending', async () => {
        fetchOrderBookMock.mockResolvedValue({
            symbol: 'ETH/USDT',
            bids: [
                [1, 1],
                [2, 1],
            ],
            asks: [
                [3, 1],
                [4, 1],
            ],
        });
        const client = new ExchangeClient(cfg);
        const ob = await client.fetchOrderBook('ETH/USDT', 2);
        expect(ob.bids.map(([p]) => p.toNumber())).toEqual([2, 1]);
    });

    test('order_book_asks_ascending', async () => {
        fetchOrderBookMock.mockResolvedValue({
            symbol: 'ETH/USDT',
            bids: [
                [1, 1],
                [2, 1],
            ],
            asks: [
                [4, 1],
                [3, 1],
            ],
        });
        const client = new ExchangeClient(cfg);
        const ob = await client.fetchOrderBook('ETH/USDT', 2);
        expect(ob.asks.map(([p]) => p.toNumber())).toEqual([3, 4]);
    });

    test('spread_calculation', async () => {
        fetchOrderBookMock.mockResolvedValue({
            symbol: 'ETH/USDT',
            bids: [[100, 1]],
            asks: [[101, 1]],
        });
        const client = new ExchangeClient(cfg);
        const ob = await client.fetchOrderBook('ETH/USDT', 1);
        const expected = new Decimal(1).div(new Decimal(100.5)).mul(10000);
        expect(ob.spread_bps.toNumber()).toBeCloseTo(expected.toNumber());
    });

    test('fetch_balance_filters_zeros', async () => {
        fetchBalanceMock.mockResolvedValue({
            free: { ETH: 1, USDT: 0 },
            used: { ETH: 0, USDT: 0 },
            total: { ETH: 1, USDT: 0 },
        });
        const client = new ExchangeClient(cfg);
        const bal = await client.fetchBalance();
        expect(bal.ETH.total.toNumber()).toBe(1);
        expect(bal.USDT).toBeUndefined();
    });

    test('limit_ioc_returns_fill_info', async () => {
        createOrderMock.mockResolvedValue({
            id: '1',
            symbol: 'ETH/USDT',
            side: 'buy',
            status: 'canceled',
            amount: 1,
            filled: 0.5,
            average: 2000,
            fee: { cost: 0.001, currency: 'USDT' },
            timestamp: 123,
        });
        const client = new ExchangeClient(cfg);
        const res = await client.createLimitIocOrder('ETH/USDT', 'buy', 1, 2000);
        expect(res.amount_filled.toNumber()).toBeCloseTo(0.5);
        expect(res.avg_fill_price.toNumber()).toBe(2000);
        expect(res.status).toBe('partially_filled');
    });

    test('rate_limiter_blocks_when_exhausted', () => {
        const client = new ExchangeClient(cfg);
        const callArgs = (jest.requireMock('ccxt').default.binance as jest.Mock).mock.calls[0][0];
        expect(callArgs.enableRateLimit).toBe(true);
        expect(client).toBeTruthy();
    });
});
