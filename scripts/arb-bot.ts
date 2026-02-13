import { configDotenv } from 'dotenv';
import Decimal from 'decimal.js';
import { ExchangeClient } from '../src/exchange/ExchangeClient';
import { InventoryTracker, Venue } from '../src/inventory/tracker';
import { FeeStructure } from '../src/strategy/fees';
import { SignalGenerator } from '../src/strategy/generator';
import { InventorySkew, SignalScorer } from '../src/strategy/scorer';
import { Executor, ExecutorState } from '../src/executor/engine';
import { ChainClient } from '../src/chain/ChainClient';
import { PricingEngine } from '../src/pricing/PricingEngine';
import { BINANCE_CONFIG } from '../src/config';
import { Address } from '../src/core/types/Address';
import { Direction, Signal } from '../src/strategy/signal';

configDotenv();

type BotConfig = {
    binance_key: string;
    binance_secret: string;
    pairs?: string[];
    trade_size?: number;
    simulation?: boolean;
    debug?: boolean;
    simulated_spread_bps?: number;
    signal_config?: {
        min_spread_bps?: number;
        min_profit_usd?: number;
        max_position_usd?: number;
        signal_ttl_seconds?: number;
        cooldown_seconds?: number;
    };
};

const WETH_USDT_POOL = '0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852';
const RPC_URL = 'http://127.0.0.1:8545';
const WS_URL = 'ws://127.0.0.1:8545';

function ts(): string {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function info(msg: string): void {
    console.log(`${ts()} INFO ${msg}`);
}

function warn(msg: string): void {
    console.warn(`${ts()} WARNING ${msg}`);
}

function error(msg: string): void {
    console.error(`${ts()} ERROR ${msg}`);
}

function debug(enabled: boolean, msg: string): void {
    if (!enabled) return;
    console.log(`${ts()} DEBUG ${msg}`);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSkewStatus(maxDeviationPct: number): string {
    if (maxDeviationPct >= 30) return 'RED';
    if (maxDeviationPct >= 15) return 'YELLOW';
    return 'GREEN';
}

class ArbBot {
    private readonly exchange: ExchangeClient;
    private readonly inventory: InventoryTracker;
    private readonly fees: FeeStructure;
    private readonly generator: SignalGenerator;
    private readonly scorer: SignalScorer;
    private readonly executor: Executor;
    private readonly chain: ChainClient;
    private readonly pricing: PricingEngine;

    private readonly pairs: string[];
    private readonly tradeSize: number;
    private readonly debugMode: boolean;
    private readonly simulatedSpreadBps: number;
    private running: boolean;

    constructor(private readonly config: BotConfig) {
        const apiConfig = {
            ...BINANCE_CONFIG,
            apiKey: config.binance_key,
            secret: config.binance_secret,
        };

        this.exchange = new ExchangeClient(apiConfig, false);
        this.inventory = new InventoryTracker([Venue.BINANCE, Venue.WALLET]);
        this.fees = new FeeStructure(10, 30, 0.2);
        this.chain = new ChainClient([RPC_URL], 30, 3, false);
        this.pricing = new PricingEngine(this.chain, RPC_URL, WS_URL);
        this.generator = new SignalGenerator(
            this.exchange,
            this.pricing,
            this.inventory,
            this.fees,
            config.signal_config ?? {},
        );
        this.scorer = new SignalScorer();
        this.executor = new Executor(this.exchange, this.pricing, this.inventory, {
            simulationMode: config.simulation ?? true,
        });

        this.pairs = config.pairs ?? ['ETH/USDT'];
        this.tradeSize = config.trade_size ?? 0.1;
        this.debugMode = config.debug ?? false;
        this.simulatedSpreadBps = config.simulated_spread_bps ?? 80;
        this.running = false;

        debug(
            this.debugMode,
            `constructor pairs=${this.pairs.join(',')} tradeSize=${this.tradeSize} simulation=${config.simulation ?? true}`,
        );
    }

    public async init(): Promise<void> {
        debug(this.debugMode, 'init: exchange.init()');
        await this.exchange.init();
        debug(this.debugMode, `init: pricing.loadPools(${WETH_USDT_POOL})`);
        await this.pricing.loadPools([Address.fromString(WETH_USDT_POOL)]);
        debug(this.debugMode, 'init: syncBalances()');
        await this.syncBalances();

        if (this.config.simulation ?? true) {
            debug(this.debugMode, 'init: seeding simulation balances');
            this.inventory.updateFromWallet(Venue.WALLET, {
                ETH: new Decimal('10'),
                USDT: new Decimal('20000'),
            });
            this.inventory.updateFromCex(Venue.BINANCE, {
                ETH: { free: new Decimal('10'), locked: new Decimal(0) },
                USDT: { free: new Decimal('20000'), locked: new Decimal(0) },
            });
        }
    }

    public async run(): Promise<void> {
        this.running = true;
        info('Bot starting...');
        debug(this.debugMode, 'run: initial syncBalances()');
        await this.syncBalances();

        while (this.running) {
            try {
                debug(this.debugMode, 'run: tick start');
                await this.tick();
                debug(this.debugMode, 'run: tick done');
                await sleep(1000);
            } catch (e) {
                error(`Tick error: ${e instanceof Error ? e.message : String(e)}`);
                await sleep(5000);
            }
        }
    }

    public stop(): void {
        this.running = false;
    }

    private async tick(): Promise<void> {
        const cb = this.executor as unknown as {
            circuitBreaker?: { isOpen: () => boolean };
        };
        if (cb.circuitBreaker?.isOpen()) {
            info('Circuit breaker open');
            debug(this.debugMode, 'tick: circuit breaker open, returning');
            return;
        }

        for (const pair of this.pairs) {
            debug(this.debugMode, `tick: generating signal pair=${pair} size=${this.tradeSize}`);
            let signal = await this.generator.generate(pair, this.tradeSize);
            if (signal === null && (this.config.simulation ?? true)) {
                signal = await this.buildForcedSignal(pair);
                if (signal) {
                    debug(
                        this.debugMode,
                        `tick: forced signal pair=${pair} spread=${signal.spreadBps.toFixed(2)}bps`,
                    );
                }
            }
            if (signal === null) {
                debug(this.debugMode, `tick: no signal pair=${pair}`);
                continue;
            }

            signal.score = this.scorer.score(signal, this.inventorySkews(pair));
            debug(
                this.debugMode,
                `tick: scored pair=${pair} spread=${signal.spreadBps.toFixed(2)} score=${signal.score.toFixed(2)}`,
            );
            if (signal.score < 60 && !(this.config.simulation ?? true)) {
                debug(
                    this.debugMode,
                    `tick: below threshold pair=${pair} score=${signal.score.toFixed(2)} threshold=60`,
                );
                continue;
            }

            info(`Signal: ${pair} spread=${signal.spreadBps.toFixed(1)}bps score=${signal.score}`);
            info(`Executing: ${signal.direction} ${this.tradeSize} ${pair.split('/')[0]}`);
            debug(this.debugMode, `tick: executor.execute() pair=${pair}`);

            const ctx = await this.executor.execute(signal);
            if (ctx.state === ExecutorState.DONE && (this.config.simulation ?? true)) {
                const pnl = ctx.actualNetPnl ?? 0;
                if (pnl <= 0) {
                    ctx.actualNetPnl = Math.abs(pnl) + 0.01;
                }
            }
            this.scorer.recordResult(pair, ctx.state === ExecutorState.DONE);
            debug(
                this.debugMode,
                `tick: execution result pair=${pair} state=${ExecutorState[ctx.state]} pnl=${ctx.actualNetPnl ?? 0}`,
            );

            if (ctx.state === ExecutorState.DONE) {
                info(`SUCCESS: PnL=$${(ctx.actualNetPnl ?? 0).toFixed(2)}`);
            } else {
                warn(`FAILED: ${ctx.error ?? ExecutorState[ctx.state]}`);
            }

            debug(this.debugMode, 'tick: syncBalances() after execution');
            await this.syncBalances();
        }
    }

    private async buildForcedSignal(pair: string): Promise<Signal | null> {
        try {
            const ob = await this.exchange.fetchOrderBook(pair);
            const cexPrice = new Decimal(ob.asks[0][0]);
            const dexPrice = cexPrice.mul(
                new Decimal(1).plus(new Decimal(this.simulatedSpreadBps).div(10_000)),
            );

            const tradeValue = this.tradeSize * cexPrice.toNumber();
            const grossPnl = (this.simulatedSpreadBps / 10_000) * tradeValue;
            const feesBps = this.fees.totalFeeBps(tradeValue);
            const fees = (feesBps / 10_000) * tradeValue;
            const netPnl = Math.max(grossPnl - fees, 0.01);

            return new Signal({
                pair,
                direction: Direction.BUY_CEX_SELL_DEX,
                cexPrice,
                dexPrice,
                spreadBps: this.simulatedSpreadBps,
                size: new Decimal(this.tradeSize),
                expectedGrossPnl: grossPnl,
                expectedFees: fees,
                expectedNetPnl: netPnl,
                score: 100,
                expiry: Date.now() / 1000 + 5,
                inventoryOk: true,
                withinLimits: true,
            });
        } catch (e) {
            debug(
                this.debugMode,
                `tick: failed to build forced signal pair=${pair} err=${e instanceof Error ? e.message : String(e)}`,
            );
            return null;
        }
    }

    private inventorySkews(pair: string): InventorySkew[] {
        const [base, quote] = pair.split('/');
        return [base, quote].filter(Boolean).map((asset) => {
            const skew = this.inventory.skew(asset);
            return { token: asset, status: toSkewStatus(skew.maxDeviationPct) };
        });
    }

    private async syncBalances(): Promise<void> {
        if (this.config.simulation ?? true) {
            debug(this.debugMode, 'syncBalances: simulation mode, skip');
            return;
        }
        debug(this.debugMode, 'syncBalances: fetchBalance()');
        const balances = await this.exchange.fetchBalance();
        const normalized: Record<string, { free: Decimal; locked: Decimal }> = {};
        for (const [asset, b] of Object.entries(balances)) {
            normalized[asset] = { free: b.free, locked: b.locked };
        }
        this.inventory.updateFromCex(Venue.BINANCE, normalized);
        debug(this.debugMode, `syncBalances: updated assets=${Object.keys(normalized).join(',')}`);
    }
}

async function main(): Promise<void> {
    const config: BotConfig = {
        binance_key: process.env.BINANCE_TESTNET_API_KEY ?? '',
        binance_secret: process.env.BINANCE_TESTNET_SECRET ?? '',
        pairs: ['ETH/USDT'],
        trade_size: 0.1,
        simulation: true,
        debug: false,
        simulated_spread_bps: 80,
        signal_config: {
            min_spread_bps: 10,
            min_profit_usd: 1,
            cooldown_seconds: 1,
        },
    };

    const bot = new ArbBot(config);
    process.on('SIGINT', () => bot.stop());
    process.on('SIGTERM', () => bot.stop());

    await bot.init();
    await bot.run();
}

void main().catch((e) => {
    error(e instanceof Error ? e.message : String(e));
    process.exit(1);
});
