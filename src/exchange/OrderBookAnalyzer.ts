import Decimal from 'decimal.js';
import { NormalizedOrderBook } from './ExchangeClient';

type Fill = { price: Decimal; qty: Decimal; cost: Decimal };

export class OrderBookAnalyzer {
    private readonly bids: [Decimal, Decimal][];
    private readonly asks: [Decimal, Decimal][];
    private readonly bestBid: [Decimal, Decimal];
    private readonly bestAsk: [Decimal, Decimal];
    private readonly mid: Decimal;

    constructor(orderbook: NormalizedOrderBook) {
        if (!orderbook.bids.length || !orderbook.asks.length) {
            throw new Error('OrderBookAnalyzer initialized with empty orderbook');
        }
        this.bids = orderbook.bids;
        this.asks = orderbook.asks;
        this.bestBid = orderbook.best_bid;
        this.bestAsk = orderbook.best_ask;
        this.mid = orderbook.mid_price;
    }

    walkTheBook(side: 'buy' | 'sell', qty: number) {
        const target = new Decimal(qty);
        const levels = side === 'buy' ? this.asks : this.bids;
        const bestPrice = side === 'buy' ? this.bestAsk[0] : this.bestBid[0];
        let remaining = target;
        let totalCost = new Decimal(0);
        let filled = new Decimal(0);
        let levelsConsumed = 0;
        const fills: Fill[] = [];
        for (const [price, levelQty] of levels) {
            if (remaining.lte(0)) break;
            const takeQty = Decimal.min(levelQty, remaining);
            const cost = price.mul(takeQty);
            fills.push({ price, qty: takeQty, cost });
            totalCost = totalCost.add(cost);
            filled = filled.add(takeQty);
            remaining = remaining.sub(takeQty);
            levelsConsumed += 1;
        }
        const fullyFilled = remaining.lte(0);
        const avgPrice = filled.gt(0) ? totalCost.div(filled) : new Decimal(0);
        const slippageBps = filled.gt(0)
            ? avgPrice.sub(bestPrice).div(bestPrice).mul(10_000).abs()
            : new Decimal(0);
        return {
            avg_price: avgPrice,
            total_cost: totalCost,
            slippage_bps: slippageBps,
            levels_consumed: levelsConsumed,
            fully_filled: fullyFilled,
            fills,
        };
    }

    depthAtBps(side: 'bid' | 'ask', bps: number): Decimal {
        const threshold =
            side === 'bid'
                ? this.bestBid[0].mul(new Decimal(1).sub(new Decimal(bps).div(10_000)))
                : this.bestAsk[0].mul(new Decimal(1).add(new Decimal(bps).div(10_000)));
        const levels = side === 'bid' ? this.bids : this.asks;
        let total = new Decimal(0);
        for (const [price, qty] of levels) {
            if (side === 'bid') {
                if (price.lt(threshold)) break;
            } else {
                if (price.gt(threshold)) break;
            }
            total = total.add(qty);
        }
        return total;
    }

    imbalance(levels = 10): number {
        const bidSlice = this.bids.slice(0, levels);
        const askSlice = this.asks.slice(0, levels);
        const bidQty = bidSlice.reduce((s, [, q]) => s.add(q), new Decimal(0));
        const askQty = askSlice.reduce((s, [, q]) => s.add(q), new Decimal(0));
        if (bidQty.add(askQty).eq(0)) return 0;
        return bidQty.sub(askQty).div(bidQty.add(askQty)).toNumber();
    }

    effectiveSpread(qty: number): Decimal {
        const buy = this.walkTheBook('buy', qty);
        const sell = this.walkTheBook('sell', qty);
        if (buy.avg_price.eq(0) || sell.avg_price.eq(0) || this.mid.eq(0)) return new Decimal(0);
        return buy.avg_price.sub(sell.avg_price).div(this.mid).mul(10_000).abs();
    }
}
