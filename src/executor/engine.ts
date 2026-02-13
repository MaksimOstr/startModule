import { ExchangeClient } from '../exchange/ExchangeClient';
import { InventoryTracker } from '../inventory/tracker';
import { PricingEngine } from '../pricing/PricingEngine';
import { Token } from '../pricing/Token';
import { Address } from '../core/types/Address';
import { Direction, Signal } from '../strategy/signal';
import { CircuitBreaker, ReplayProtection } from './recovery';
import Decimal from 'decimal.js';

export enum ExecutorState {
    IDLE,
    VALIDATING,
    LEG1_PENDING,
    LEG1_FILLED,
    LEG2_PENDING,
    DONE,
    FAILED,
    UNWINDING,
}

export type ExecutionContext = {
    signal: Signal;
    state: ExecutorState;
    leg1Venue: string;
    leg1OrderId: string | null;
    leg1FillPrice: number | null;
    leg1FillSize: number | null;
    leg2Venue: string;
    leg2TxHash: string | null;
    leg2FillPrice: number | null;
    leg2FillSize: number | null;
    startedAt: number;
    finishedAt: number | null;
    actualNetPnl: number | null;
    error: string | null;
};

export type ExecutorConfig = {
    leg1Timeout?: number;
    leg2Timeout?: number;
    minFillRatio?: number;
    useFlashbots?: boolean;
    simulationMode?: boolean;
};

type LegExecutionResult = {
    success: boolean;
    price: number;
    filled: number;
    orderId?: string;
    txHash?: string;
    error?: string;
};

const defaultExecutorConfig: Required<ExecutorConfig> = {
    leg1Timeout: 5,
    leg2Timeout: 60,
    minFillRatio: 0.8,
    useFlashbots: true,
    simulationMode: true,
};

class TimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TimeoutError';
    }
}

export class Executor {
    private exchange: ExchangeClient;
    private priceEngine: PricingEngine;
    private inventory: InventoryTracker;
    private config: Required<ExecutorConfig>;
    private circuitBreaker: CircuitBreaker;
    private replayProtection: ReplayProtection;
    private readonly tokenMap: Record<string, string> = {
        ETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    };
    private readonly decimalsMap: Record<string, number> = {
        ETH: 18,
        WETH: 18,
        USDT: 6,
        USDC: 6,
    };

    constructor(
        exchangeClient: ExchangeClient,
        priceEngine: PricingEngine,
        inventoryTracker: InventoryTracker,
        config: ExecutorConfig = {},
    ) {
        this.exchange = exchangeClient;
        this.priceEngine = priceEngine;
        this.inventory = inventoryTracker;
        this.config = { ...defaultExecutorConfig, ...config };
        this.circuitBreaker = new CircuitBreaker();
        this.replayProtection = new ReplayProtection();
    }

    public async execute(signal: Signal): Promise<ExecutionContext> {
        let context = this.createContext(signal);

        if (this.circuitBreaker.isOpen()) {
            context.state = ExecutorState.FAILED;
            context.error = 'Circuit breaker open';
            return context;
        }

        if (this.replayProtection.isDuplicate(signal)) {
            context.state = ExecutorState.FAILED;
            context.error = 'Duplicate signal';
            return context;
        }

        context.state = ExecutorState.VALIDATING;
        if (!signal.isValid()) {
            context.state = ExecutorState.FAILED;
            context.error = 'Signal invalid';
            return context;
        }

        if (this.config.useFlashbots) {
            context = await this.executeDexFirst(context);
        } else {
            context = await this.executeCexFirst(context);
        }

        this.replayProtection.markExecuted(signal);
        if (context.state === ExecutorState.DONE) {
            this.circuitBreaker.recordSuccess();
        } else {
            this.circuitBreaker.recordFailure();
        }

        context.finishedAt = Date.now() / 1000;
        return context;
    }

    private createContext(signal: Signal): ExecutionContext {
        return {
            signal,
            state: ExecutorState.IDLE,
            leg1Venue: '',
            leg1OrderId: null,
            leg1FillPrice: null,
            leg1FillSize: null,
            leg2Venue: '',
            leg2TxHash: null,
            leg2FillPrice: null,
            leg2FillSize: null,
            startedAt: Date.now() / 1000,
            finishedAt: null,
            actualNetPnl: null,
            error: null,
        };
    }

    private async executeCexFirst(context: ExecutionContext): Promise<ExecutionContext> {
        const { signal } = context;

        context.state = ExecutorState.LEG1_PENDING;
        context.leg1Venue = 'cex';

        let leg1: LegExecutionResult;
        try {
            leg1 = await this.waitFor(this.executeCexLeg(signal), this.config.leg1Timeout);
        } catch (error) {
            if (error instanceof TimeoutError) {
                context.state = ExecutorState.FAILED;
                context.error = 'CEX timeout';
                return context;
            }
            context.state = ExecutorState.FAILED;
            context.error = error instanceof Error ? error.message : 'CEX rejected';
            return context;
        }

        if (!leg1.success) {
            context.state = ExecutorState.FAILED;
            context.error = leg1.error ?? 'CEX rejected';
            return context;
        }

        if (leg1.filled / signal.size.toNumber() < this.config.minFillRatio) {
            context.state = ExecutorState.FAILED;
            context.error = 'Partial fill below threshold';
            return context;
        }

        context.leg1OrderId = leg1.orderId ?? null;
        context.leg1FillPrice = leg1.price;
        context.leg1FillSize = leg1.filled;
        context.state = ExecutorState.LEG1_FILLED;

        context.state = ExecutorState.LEG2_PENDING;
        context.leg2Venue = 'dex';

        let leg2: LegExecutionResult;
        try {
            leg2 = await this.waitFor(
                this.executeDexLeg(signal, context.leg1FillSize),
                this.config.leg2Timeout,
            );
        } catch (error) {
            if (error instanceof TimeoutError) {
                context.state = ExecutorState.UNWINDING;
                await this.unwind(context);
                context.state = ExecutorState.FAILED;
                context.error = 'DEX timeout - unwound';
                return context;
            }
            context.state = ExecutorState.UNWINDING;
            await this.unwind(context);
            context.state = ExecutorState.FAILED;
            context.error =
                error instanceof Error ? `${error.message} - unwound` : 'DEX failed - unwound';
            return context;
        }

        if (!leg2.success) {
            context.state = ExecutorState.UNWINDING;
            await this.unwind(context);
            context.state = ExecutorState.FAILED;
            context.error = 'DEX failed - unwound';
            return context;
        }

        context.leg2TxHash = leg2.txHash ?? null;
        context.leg2FillPrice = leg2.price;
        context.leg2FillSize = leg2.filled;
        context.actualNetPnl = this.calculatePnl(context);
        context.state = ExecutorState.DONE;
        return context;
    }

    private async executeDexFirst(context: ExecutionContext): Promise<ExecutionContext> {
        const { signal } = context;

        context.state = ExecutorState.LEG1_PENDING;
        context.leg1Venue = 'dex';

        let leg1: LegExecutionResult;
        try {
            leg1 = await this.waitFor(
                this.executeDexLeg(signal, signal.size.toNumber()),
                this.config.leg2Timeout,
            );
        } catch (error) {
            if (error instanceof TimeoutError) {
                context.state = ExecutorState.FAILED;
                context.error = 'DEX timeout';
                return context;
            }
            context.state = ExecutorState.FAILED;
            context.error = error instanceof Error ? error.message : 'DEX failed';
            return context;
        }

        if (!leg1.success) {
            context.state = ExecutorState.FAILED;
            context.error = 'DEX failed (no cost via Flashbots)';
            return context;
        }

        context.leg1FillPrice = leg1.price;
        context.leg1FillSize = leg1.filled;
        context.state = ExecutorState.LEG1_FILLED;

        context.state = ExecutorState.LEG2_PENDING;
        context.leg2Venue = 'cex';

        let leg2: LegExecutionResult;
        try {
            leg2 = await this.waitFor(
                this.executeCexLeg(signal, context.leg1FillSize),
                this.config.leg1Timeout,
            );
        } catch (error) {
            if (error instanceof TimeoutError) {
                context.state = ExecutorState.UNWINDING;
                await this.unwind(context);
                context.state = ExecutorState.FAILED;
                context.error = 'CEX timeout after DEX - unwound';
                return context;
            }
            context.state = ExecutorState.UNWINDING;
            await this.unwind(context);
            context.state = ExecutorState.FAILED;
            context.error =
                error instanceof Error
                    ? `${error.message} after DEX - unwound`
                    : 'CEX failed after DEX - unwound';
            return context;
        }

        if (!leg2.success) {
            context.state = ExecutorState.UNWINDING;
            await this.unwind(context);
            context.state = ExecutorState.FAILED;
            context.error = 'CEX failed after DEX - unwound';
            return context;
        }

        context.leg2TxHash = leg2.orderId ?? null;
        context.leg2FillPrice = leg2.price;
        context.leg2FillSize = leg2.filled;
        context.actualNetPnl = this.calculatePnl(context);
        context.state = ExecutorState.DONE;
        return context;
    }

    private async executeCexLeg(signal: Signal, size?: number): Promise<LegExecutionResult> {
        const actualSize = size ?? signal.size.toNumber();
        if (this.config.simulationMode) {
            await this.sleep(100);
            return {
                success: true,
                price: signal.cexPrice.mul(1.0001).toNumber(),
                filled: actualSize,
            };
        }

        const side = signal.direction === Direction.BUY_CEX_SELL_DEX ? 'buy' : 'sell';
        const result = await this.exchange.createLimitIocOrder(
            signal.pair,
            side,
            actualSize,
            signal.cexPrice.mul(1.001).toNumber(),
        );

        return {
            success: result.status === 'filled',
            price: result.avg_fill_price.toNumber(),
            filled: result.amount_filled.toNumber(),
            orderId: result.id,
            error: result.status,
        };
    }

    private async executeDexLeg(signal: Signal, size: number): Promise<LegExecutionResult> {
        if (this.config.simulationMode) {
            await this.sleep(500);
            return {
                success: true,
                price: signal.dexPrice.mul(0.9998).toNumber(),
                filled: size,
                txHash: `sim-${signal.signalId}`,
            };
        }

        try {
            const [baseSymbolRaw, quoteSymbolRaw] = signal.pair.split('/');
            const baseSymbol = baseSymbolRaw.toUpperCase();
            const quoteSymbol = quoteSymbolRaw.toUpperCase();
            const baseAddress = this.tokenMap[baseSymbol];
            const quoteAddress = this.tokenMap[quoteSymbol];
            if (!baseAddress || !quoteAddress) {
                return {
                    success: false,
                    price: 0,
                    filled: 0,
                    error: `Unsupported DEX pair ${signal.pair}`,
                };
            }

            const baseDecimals = this.decimalsMap[baseSymbol] ?? 18;
            const quoteDecimals = this.decimalsMap[quoteSymbol] ?? 18;
            const gasPriceGwei = await this.priceEngine.fetchGasPriceGwei();

            if (signal.direction === Direction.BUY_CEX_SELL_DEX) {
                const amountInWei = this.toWei(size, baseDecimals);
                const quote = await this.priceEngine.getQuote(
                    new Token(baseSymbol, baseDecimals, new Address(baseAddress)),
                    new Token(quoteSymbol, quoteDecimals, new Address(quoteAddress)),
                    amountInWei,
                    gasPriceGwei,
                );
                if (!quote.isValid || quote.simulatedOutput <= 0n) {
                    return {
                        success: false,
                        price: 0,
                        filled: 0,
                        error: 'DEX quote invalid for sell leg',
                    };
                }

                const quoteOut = this.fromWei(quote.simulatedOutput, quoteDecimals);
                const execPrice = quoteOut.div(size).toNumber();
                return {
                    success: true,
                    price: execPrice,
                    filled: size,
                    txHash: `dex-${signal.signalId}-${Math.floor(Date.now() / 1000)}`,
                };
            }

            const quoteToSpend = new Decimal(size).mul(signal.cexPrice);
            const amountInQuoteWei = this.toWei(quoteToSpend, quoteDecimals);
            const quote = await this.priceEngine.getQuote(
                new Token(quoteSymbol, quoteDecimals, new Address(quoteAddress)),
                new Token(baseSymbol, baseDecimals, new Address(baseAddress)),
                amountInQuoteWei,
                gasPriceGwei,
            );
            if (!quote.isValid || quote.simulatedOutput <= 0n) {
                return {
                    success: false,
                    price: 0,
                    filled: 0,
                    error: 'DEX quote invalid for buy leg',
                };
            }

            const baseOut = this.fromWei(quote.simulatedOutput, baseDecimals);
            const filledBase = baseOut.toNumber();
            if (filledBase <= 0) {
                return { success: false, price: 0, filled: 0, error: 'DEX produced zero fill' };
            }

            return {
                success: true,
                price: quoteToSpend.div(baseOut).toNumber(),
                filled: filledBase,
                txHash: `dex-${signal.signalId}-${Math.floor(Date.now() / 1000)}`,
            };
        } catch (error) {
            return {
                success: false,
                price: 0,
                filled: 0,
                error: error instanceof Error ? error.message : 'DEX execution failed',
            };
        }
    }

    private async unwind(context: ExecutionContext): Promise<void> {
        if (this.config.simulationMode) {
            await this.sleep(100);
            return;
        }

        if (!context.leg1FillSize) {
            throw new Error('Cannot unwind without leg1 fill size');
        }

        if (context.leg1Venue === 'cex') {
            const side = context.signal.direction === Direction.BUY_CEX_SELL_DEX ? 'sell' : 'buy';
            await this.exchange.createMarketOrder(context.signal.pair, side, context.leg1FillSize);
            return;
        }

        if (context.leg1Venue === 'dex') {
            const reverseSignal = this.reverseSignalDirection(context.signal);
            const unwindResult = await this.executeDexLeg(reverseSignal, context.leg1FillSize);
            if (!unwindResult.success) {
                throw new Error(unwindResult.error ?? 'DEX unwind failed');
            }
            return;
        }

        throw new Error(`Unsupported unwind venue: ${context.leg1Venue}`);
    }

    private reverseSignalDirection(signal: Signal): Signal {
        const reverseDirection =
            signal.direction === Direction.BUY_CEX_SELL_DEX
                ? Direction.BUY_DEX_SELL_CEX
                : Direction.BUY_CEX_SELL_DEX;

        return new Signal({
            signalId: `${signal.signalId}_unwind`,
            pair: signal.pair,
            direction: reverseDirection,
            cexPrice: signal.cexPrice,
            dexPrice: signal.dexPrice,
            spreadBps: signal.spreadBps,
            size: signal.size,
            expectedGrossPnl: signal.expectedGrossPnl,
            expectedFees: signal.expectedFees,
            expectedNetPnl: signal.expectedNetPnl,
            score: signal.score,
            expiry: signal.expiry,
            inventoryOk: signal.inventoryOk,
            withinLimits: signal.withinLimits,
            timestamp: signal.timestamp,
        });
    }

    private calculatePnl(context: ExecutionContext): number {
        if (
            context.leg1FillPrice === null ||
            context.leg2FillPrice === null ||
            context.leg1FillSize === null
        ) {
            return 0;
        }

        const { signal } = context;
        const gross =
            signal.direction === Direction.BUY_CEX_SELL_DEX
                ? (context.leg2FillPrice - context.leg1FillPrice) * context.leg1FillSize
                : (context.leg1FillPrice - context.leg2FillPrice) * context.leg1FillSize;
        const fees = context.leg1FillSize * context.leg1FillPrice * 0.004;
        return gross - fees;
    }

    private async waitFor<T>(promise: Promise<T>, timeoutSeconds: number): Promise<T> {
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new TimeoutError('Timed out')), timeoutSeconds * 1000);
        });
        return Promise.race([promise, timeoutPromise]);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
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
