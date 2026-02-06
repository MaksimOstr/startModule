import ccxt, { Exchange, Order, Str } from 'ccxt';
import Decimal from 'decimal.js';
import { BINANCE_CONFIG, PlatformConfig } from '../../configs/config';

export type OrderBookSide = [Decimal, Decimal][];

export type NormalizedOrderBook = {
    symbol: string;
    timestamp: number;
    bids: OrderBookSide;
    asks: OrderBookSide;
    best_bid: [Decimal, Decimal];
    best_ask: [Decimal, Decimal];
    mid_price: Decimal;
    spread_bps: Decimal;
};

export type NormalizedBalance = Record<string, { free: Decimal; locked: Decimal; total: Decimal }>;

export type NormalizedOrder = {
    id: string;
    symbol: string;
    side: 'buy' | 'sell' | Str;
    type: 'limit' | 'market' | Str;
    time_in_force: 'IOC' | 'GTC' | 'FOK' | 'PO' | Str;
    amount_requested: Decimal;
    amount_filled: Decimal;
    avg_fill_price: Decimal;
    fee: Decimal;
    fee_asset: string;
    status: 'filled' | 'partially_filled' | 'expired';
    timestamp: number;
};

export class ExchangeClient {
    private exchange: Exchange;
    private isInitialized = false;
    private readonly isSandbox: boolean;

    constructor(config: PlatformConfig = BINANCE_CONFIG) {
        if (!config.apiKey || !config.secret) {
            throw new Error('Binance API credentials are required');
        }

        try {
            this.isSandbox = !!config.sandbox;
            this.exchange = new ccxt.binance({
                ...config,
                adjustForTimeDifference: true,
            });
            if (this.isSandbox && this.exchange.setSandboxMode) {
                this.exchange.setSandboxMode(true);
            }
            this.log('init_exchange', 'Successfully initialized');
        } catch (err) {
            if (err instanceof ccxt.AuthenticationError) {
                this.logError('init_auth', 'Authentication failed. Check API keys.');
            } else if (err instanceof ccxt.NetworkError) {
                this.logError('init_network', 'Network error connecting to Binance.');
            } else {
                this.logError('init', err);
            }
            throw err;
        }
    }

    public async init() {
        if (this.isInitialized) return;

        try {
            await this.exchange.loadTimeDifference();
            await this.exchange.loadMarkets();
            if (this.exchange.loadTimeDifference) {
                const diff = await this.exchange.loadTimeDifference();
                this.log('time_sync', { ms: diff });
            }
            this.isInitialized = true;
            this.log('init_exchange', 'Successfully initialized markets');
        } catch (err) {
            this.logError('init', err);
            throw err;
        }
    }

    private log(action: string, payload: unknown) {
        console.info(`[ExchangeClient] ${action}`, payload);
    }

    private logError(action: string, err: unknown) {
        console.error(`[ExchangeClient] ${action} error`, err);
    }

    private normalizeSide(levels: [number, number][], descending: boolean): OrderBookSide {
        const sorted = [...levels].sort((a, b) => (descending ? b[0] - a[0] : a[0] - b[0]));
        return sorted.map(([price, qty]) => [new Decimal(price), new Decimal(qty)]);
    }

    async fetchOrderBook(symbol: string, limit = 20): Promise<NormalizedOrderBook> {
        try {
            this.log('fetch_order_book_request', { symbol, limit });
            const ob = await this.exchange.fetchOrderBook(symbol, limit);

            if (!ob || !Array.isArray(ob.bids) || !Array.isArray(ob.asks)) {
                throw new Error('Order book response missing bids or asks');
            }

            const bids = this.normalizeSide(ob.bids as [number, number][], true);
            const asks = this.normalizeSide(ob.asks as [number, number][], false);

            if (!bids.length || !asks.length) {
                throw new Error('Order book missing bids or asks');
            }

            const bestBid = bids[0];
            const bestAsk = asks[0];
            const mid = bestBid[0].plus(bestAsk[0]).div(2);
            const spread = bestAsk[0].minus(bestBid[0]);
            const spreadBps = spread.div(mid).mul(10_000);

            const result: NormalizedOrderBook = {
                symbol: ob.symbol ?? symbol,
                timestamp: ob.timestamp ?? Date.now(),
                bids,
                asks,
                best_bid: bestBid,
                best_ask: bestAsk,
                mid_price: mid,
                spread_bps: spreadBps,
            };
            this.log('fetch_order_book_response', {
                symbol: result.symbol,
                bids: bids.length,
                asks: asks.length,
            });
            return result;
        } catch (err) {
            this.logError('fetch_order_book', err);
            throw err;
        }
    }

    async fetchBalance(): Promise<NormalizedBalance> {
        try {
            this.log('fetch_balance_request', {});
            const balance = await this.exchange.fetchBalance();
            if (!balance || typeof balance !== 'object') {
                this.logError('fetch_balance', 'Empty balance response');
                return {};
            }

            const result: NormalizedBalance = {};

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const [asset, total] of Object.entries((balance as any).total ?? {}) as [
                string,
                Decimal.Value,
            ][]) {
                const totalDec = new Decimal(total ?? 0);
                if (totalDec.eq(0)) continue;

                result[asset] = {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    free: new Decimal((balance.free as any)?.[asset] ?? 0),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    locked: new Decimal((balance.used as any)?.[asset] ?? 0),
                    total: totalDec,
                };
            }
            this.log('fetch_balance_response', Object.keys(result));
            return result;
        } catch (err) {
            this.logError('fetch_balance', err);
            throw err;
        }
    }

    async createLimitIocOrder(
        symbol: string,
        side: 'buy' | 'sell',
        amount: number,
        price: number,
    ): Promise<NormalizedOrder> {
        try {
            this.log('create_limit_ioc_order_request', {
                symbol,
                side,
                amount,
                price,
            });
            const order = await this.exchange.createOrder(symbol, 'limit', side, amount, price, {
                timeInForce: 'IOC',
            });
            const normalized = this.normalizeOrder(order);
            this.log('create_limit_ioc_order_response', {
                id: normalized.id,
                status: normalized.status,
                filled: normalized.amount_filled.toString(),
            });
            return normalized;
        } catch (err) {
            this.logError('create_limit_ioc_order', err);
            throw err;
        }
    }

    async createMarketOrder(
        symbol: string,
        side: 'buy' | 'sell',
        amount: number,
    ): Promise<NormalizedOrder> {
        try {
            this.log('create_market_order_request', { symbol, side, amount });
            const order = await this.exchange.createOrder(symbol, 'market', side, amount);
            const normalized = this.normalizeOrder(order);
            this.log('create_market_order_response', {
                id: normalized.id,
                status: normalized.status,
                filled: normalized.amount_filled.toString(),
            });
            return normalized;
        } catch (err) {
            this.logError('create_market_order', err);
            throw err;
        }
    }

    async cancelOrder(orderId: string, symbol: string) {
        try {
            this.log('cancel_order_request', { orderId, symbol });
            const res = await this.exchange.cancelOrder(orderId, symbol);
            this.log('cancel_order_response', { id: res.id, status: res.status });
            return res;
        } catch (err) {
            this.logError('cancel_order', err);
            throw err;
        }
    }

    async fetchOrderStatus(orderId: string, symbol: string): Promise<NormalizedOrder> {
        try {
            this.log('fetch_order_status_request', { orderId, symbol });
            const order = await this.exchange.fetchOrder(orderId, symbol);
            const normalized = this.normalizeOrder(order);
            this.log('fetch_order_status_response', {
                id: normalized.id,
                status: normalized.status,
            });
            return normalized;
        } catch (err) {
            this.logError('fetch_order_status', err);
            throw err;
        }
    }

    async getTradingFees(symbol: string): Promise<{ maker: Decimal; taker: Decimal }> {
        try {
            this.log('get_trading_fees_request', { symbol });
            await this.exchange.loadMarkets();
            const feeInfo = await this.exchange.fetchTradingFee(symbol);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const maker = new Decimal((feeInfo as any).maker ?? 0);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const taker = new Decimal((feeInfo as any).taker ?? 0);
            const result = { maker, taker };
            this.log('get_trading_fees_response', result);
            return result;
        } catch (err) {
            this.logError('get_trading_fees', err);
            throw err;
        }
    }

    private normalizeOrder(order: Order): NormalizedOrder {
        const amount = new Decimal(order.amount ?? 0);
        const filled = new Decimal(order.filled ?? 0);
        const avgPrice = new Decimal(order.average ?? 0);
        const fee = new Decimal(order.fee?.cost ?? 0);
        const feeAsset = order.fee?.currency ?? '';

        let status: NormalizedOrder['status'] = 'expired';
        const fullyFilled =
            order.status === 'closed' || filled.equals(amount) || filled.greaterThan(amount);
        if (fullyFilled) {
            status = 'filled';
        } else if (filled.gt(0)) {
            status = 'partially_filled';
        }
        return {
            id: order.id,
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            time_in_force: order.timeInForce,
            amount_requested: amount,
            amount_filled: filled,
            avg_fill_price: avgPrice,
            fee,
            fee_asset: feeAsset,
            status,
            timestamp: order.timestamp,
        };
    }
}
