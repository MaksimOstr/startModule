import Decimal from 'decimal.js';
import { TEST_BINANCE_CONFIG } from '../../src/config';
import { ExchangeClient } from '../../src/exchange/ExchangeClient';
import { OrderBookAnalyzer } from '../../src/exchange/OrderBookAnalyzer';

const symbol = 'ETH/USDT';

describe('OrderBookAnalyzer live order book', () => {
    if (!process.env.BINANCE_TESTNET_API_KEY || !process.env.BINANCE_TESTNET_SECRET) {
        test.skip('skipped - missing BINANCE_TESTNET_API_KEY/BINANCE_TESTNET_SECRET', () => {});
        return;
    }

    let analyzer: OrderBookAnalyzer;
    let bestAskPrice: Decimal;
    let bestAskQty: Decimal;
    let bestBidPrice: Decimal;
    let orderBook: Awaited<ReturnType<ExchangeClient['fetchOrderBook']>>;

    beforeAll(async () => {
        const client = new ExchangeClient(TEST_BINANCE_CONFIG);
        await client.init();
        orderBook = await client.fetchOrderBook(symbol, 50);
        analyzer = new OrderBookAnalyzer(orderBook);
        bestAskPrice = orderBook.best_ask[0];
        bestAskQty = orderBook.best_ask[1];
        bestBidPrice = orderBook.best_bid[0];
    });

    test('walk_the_book_exact_fill', () => {
        const qty = Math.min(0.001, bestAskQty.toNumber());
        const res = analyzer.walkTheBook('buy', qty);
        expect(res.fully_filled).toBe(true);
        expect(res.levels_consumed).toBe(1);
        expect(res.avg_price.toNumber()).toBeCloseTo(bestAskPrice.toNumber());
    });

    test('walk_the_book_exact_fill_sell', () => {
        const bestBidQty = orderBook.best_bid[1];
        const qty = Math.min(0.001, bestBidQty.toNumber());
        const res = analyzer.walkTheBook('sell', qty);
        expect(res.fully_filled).toBe(true);
        expect(res.levels_consumed).toBe(1);
        expect(res.avg_price.toNumber()).toBeCloseTo(bestBidPrice.toNumber());
    });

    test('walk_the_book_multiple_levels', () => {
        const asks = orderBook.asks;
        const take = asks.slice(0, 2);
        const qty = take.reduce((s, [, q]) => s.add(q), new Decimal(0)).toNumber();
        const res = analyzer.walkTheBook('buy', qty);
        expect(res.fully_filled).toBe(true);
        expect(res.levels_consumed).toBeGreaterThanOrEqual(2);
        const expectedCost = take.reduce((s, [p, q]) => s.add(p.mul(q)), new Decimal(0));
        expect(res.total_cost.toNumber()).toBeCloseTo(expectedCost.toNumber(), 6);
        expect(res.avg_price.toNumber()).toBeCloseTo(expectedCost.div(qty).toNumber(), 6);
    });

    test('walk_the_book_insufficient_liquidity', () => {
        const totalBids = orderBook.bids.reduce((s, [, q]) => s.add(q), new Decimal(0));
        const res = analyzer.walkTheBook('sell', totalBids.plus(1).toNumber());
        expect(res.fully_filled).toBe(false);
        const filledQty = res.fills.reduce((s, f) => s.add(f.qty), new Decimal(0));
        expect(filledQty.toNumber()).toBeCloseTo(totalBids.toNumber(), 6);
    });

    test('depth_at_bps_correct', () => {
        const bps = 10;
        const expected = (() => {
            const threshold = orderBook.best_ask[0].mul(
                new Decimal(1).add(new Decimal(bps).div(10_000)),
            );
            let total = new Decimal(0);
            for (const [price, qty] of orderBook.asks) {
                if (price.gt(threshold)) break;
                total = total.add(qty);
            }
            return total;
        })();
        const depth = analyzer.depthAtBps('ask', 10);
        expect(depth.toNumber()).toBeCloseTo(expected.toNumber(), 6);
    });

    test('imbalance_range', () => {
        const val = analyzer.imbalance();
        expect(val).toBeGreaterThanOrEqual(-1);
        expect(val).toBeLessThanOrEqual(1);
    });

    test('effective_spread_greater_than_quoted', () => {
        const eff = analyzer.effectiveSpread(0.01);
        expect(eff.greaterThanOrEqualTo(orderBook.spread_bps)).toBe(true);
    });
});
