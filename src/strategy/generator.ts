import Decimal from 'decimal.js';
import { Direction, Signal } from './signal';
import { FeeStructure } from './fees';
import { PricingEngine } from '../pricing/PricingEngine';
import { Token } from '../pricing/Token';
import { Address } from '../core/types/Address';
import { InventoryTracker, Venue } from '../inventory/tracker';
import { ExchangeClient } from '../exchange/ExchangeClient';
import { getLogger } from '../logger';

export type GeneratorConfig = {
    min_spread_bps?: number;
    min_profit_usd?: number;
    max_position_usd?: number;
    signal_ttl_seconds?: number;
    cooldown_seconds?: number;
    tokenMap?: Record<string, string>;
};
const tokenMap = {
    ETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
};
const DECIMALS: Record<string, number> = { ETH: 18, WETH: 18, USDT: 6, USDC: 6 };
const logger = getLogger('SignalGenerator');

export class SignalGenerator {
    private lastSignalTime: Map<string, number>;
    private minSpreadBps: number;
    private minProfitUsd: Decimal;
    private maxPositionUsd: Decimal;
    private signalTtl: number;
    private cooldown: number;
    private tokenMap: Record<string, string>;

    constructor(
        private exchange: ExchangeClient,
        private pricing: PricingEngine,
        private inventory: InventoryTracker,
        private fees: FeeStructure,
        config: GeneratorConfig = {},
    ) {
        this.minSpreadBps = config.min_spread_bps ?? 50;
        this.minProfitUsd = new Decimal(config.min_profit_usd ?? 5);
        this.maxPositionUsd = new Decimal(config.max_position_usd ?? 10_000);
        this.signalTtl = config.signal_ttl_seconds ?? 5;
        this.cooldown = config.cooldown_seconds ?? 2;
        this.tokenMap = config.tokenMap ?? tokenMap;
        this.lastSignalTime = new Map();
    }

    public async generate(pair: string, size: number): Promise<Signal | null> {
        if (this.inCooldown(pair)) return null;

        const prices = await this.fetchPrices(pair, size);
        if (!prices) return null;

        const spreadA = prices.dexSell.minus(prices.cexAsk).div(prices.cexAsk).times(10_000);
        const spreadB = prices.cexBid.minus(prices.dexBuy).div(prices.dexBuy).times(10_000);

        let direction: Direction;
        let spread: Decimal;
        let cexPrice: Decimal;
        let dexPrice: Decimal;

        if (spreadA.gt(spreadB) && spreadA.gte(this.minSpreadBps)) {
            direction = Direction.BUY_CEX_SELL_DEX;
            spread = spreadA;
            cexPrice = prices.cexAsk;
            dexPrice = prices.dexSell;
        } else if (spreadB.gte(this.minSpreadBps)) {
            direction = Direction.BUY_DEX_SELL_CEX;
            spread = spreadB;
            cexPrice = prices.cexBid;
            dexPrice = prices.dexBuy;
        } else {
            logger.info(
                `Pair: ${pair}, BUY_CEX_SELL_DEX spread: ${spreadA}, BUY_DEX_SELL_CEX spread: ${spreadB} SKIPPING`,
            );
            return null;
        }

        const tradeValue = size * cexPrice.toNumber();
        const grossPnl = (spread.toNumber() / 10_000) * tradeValue;
        const feesBps = this.fees.totalFeeBps(tradeValue);
        const fees = (feesBps / 10_000) * tradeValue;
        const netPnl = grossPnl - fees;

        if (netPnl < this.minProfitUsd.toNumber()) {
            logger.info(
                `Pair: ${pair}, chosen direction: ${direction}, netPnl: ${netPnl} SKIPPING`,
            );
            return null;
        }

        const inventoryOk = this.checkInventory(pair, direction, size, cexPrice);
        const withinLimits = new Decimal(tradeValue).lte(this.maxPositionUsd);

        const signal = new Signal({
            pair,
            direction,
            cexPrice,
            dexPrice,
            spreadBps: spread.toNumber(),
            size: new Decimal(size),
            expectedGrossPnl: grossPnl,
            expectedFees: fees,
            expectedNetPnl: netPnl,
            score: 0,
            expiry: Date.now() / 1000 + this.signalTtl,
            inventoryOk,
            withinLimits,
        });

        this.lastSignalTime.set(pair, Date.now() / 1000);
        return signal;
    }

    private inCooldown(pair: string): boolean {
        const last = this.lastSignalTime.get(pair) ?? 0;
        return Date.now() / 1000 - last < this.cooldown;
    }

    private async fetchPrices(
        pair: string,
        size: number,
    ): Promise<{ cexBid: Decimal; cexAsk: Decimal; dexBuy: Decimal; dexSell: Decimal } | null> {
        try {
            const ob = await this.exchange.fetchOrderBook(pair);
            const cexBid = new Decimal(ob.bids[0][0]);
            const cexAsk = new Decimal(ob.asks[0][0]);

            const [baseSymbol, quoteSymbol] = pair.split('/');
            const baseTokenAddress = new Address(this.tokenMap[baseSymbol]);
            const quoteTokenAddress = new Address(this.tokenMap[quoteSymbol]);
            const baseDecimals = DECIMALS[baseSymbol] ?? 18;
            const quoteDecimals = DECIMALS[quoteSymbol] ?? 18;

            const amountInWei = this.toWei(size, baseDecimals);
            const gasPriceGwei = await this.pricing.fetchGasPriceGwei();

            const sellQuote = await this.pricing.getQuote(
                new Token(baseSymbol, baseDecimals, baseTokenAddress),
                new Token(quoteSymbol, quoteDecimals, quoteTokenAddress),
                amountInWei,
                gasPriceGwei,
            );
            if (!sellQuote || sellQuote.simulatedOutput === 0n) return null;

            const sellOutHuman = this.fromWei(sellQuote.simulatedOutput, quoteDecimals);
            const dexSellPrice = sellOutHuman.div(size);

            const quoteToSpend = new Decimal(size).times(cexAsk);
            const amountInQuoteWei = this.toWei(quoteToSpend, quoteDecimals);

            const buyBase = await this.pricing.getQuote(
                new Token(quoteSymbol, quoteDecimals, quoteTokenAddress),
                new Token(baseSymbol, baseDecimals, baseTokenAddress),
                amountInQuoteWei,
                gasPriceGwei,
            );
            if (!buyBase || buyBase.simulatedOutput === 0n) return null;

            const buyOutBaseHuman = this.fromWei(buyBase.simulatedOutput, baseDecimals);
            const dexBuyPrice = quoteToSpend.div(buyOutBaseHuman);

            return { cexBid, cexAsk, dexBuy: dexBuyPrice, dexSell: dexSellPrice };
        } catch {
            return null;
        }
    }

    private checkInventory(
        pair: string,
        direction: Direction,
        size: number,
        price: Decimal,
    ): boolean {
        const [base, quote] = pair.split('/');
        const sizeDec = new Decimal(size);

        if (direction === Direction.BUY_CEX_SELL_DEX) {
            const cexBal = this.inventory.getAvailable(Venue.BINANCE, quote);
            const dexBal = this.inventory.getAvailable(Venue.WALLET, base);
            return (
                cexBal.greaterThanOrEqualTo(sizeDec.times(price).times(1.01)) &&
                dexBal.greaterThanOrEqualTo(sizeDec)
            );
        } else {
            const cexBal = this.inventory.getAvailable(Venue.BINANCE, base);
            const dexBal = this.inventory.getAvailable(Venue.WALLET, quote);
            return (
                cexBal.greaterThanOrEqualTo(sizeDec) &&
                dexBal.greaterThanOrEqualTo(sizeDec.times(price).times(1.01))
            );
        }
    }

    private toWei(amount: Decimal.Value, decimals: number): bigint {
        const dec = new Decimal(amount);
        const wei = dec.mul(new Decimal(10).pow(decimals));
        return BigInt(wei.toFixed(0));
    }

    private fromWei(amount: bigint, decimals: number): Decimal {
        return new Decimal(amount.toString()).div(new Decimal(10).pow(decimals));
    }
}
