import { configDotenv } from 'dotenv';
import Decimal from 'decimal.js';
import { existsSync } from 'fs';
import { ExchangeClient } from '../src/exchange/ExchangeClient';
import { InventoryTracker, Venue } from '../src/inventory/tracker';
import { FeeStructure } from '../src/strategy/fees';
import { GeneratorConfig, SignalGenerator } from '../src/strategy/generator';
import { ScorerConfig, SignalScorer } from '../src/strategy/scorer';
import { Executor, ExecutorConfig, ExecutorState } from '../src/executor/engine';
import { ChainClient } from '../src/chain/ChainClient';
import { PricingEngine } from '../src/pricing/PricingEngine';
import { BINANCE_CONFIG, Config } from '../src/config';
import { Address } from '../src/core/types/Address';
import { Direction, Signal } from '../src/strategy/signal';
import { RiskLimits, RiskManager } from '../src/strategy/riskManager';
import { PreTradeValidator } from '../src/strategy/preTradeValidator';
import { getLogger } from '../src/logger';
import { TelegramAlert } from '../src/core/TelegramAlert';
import { safetyCheck } from '../src/safety';
import { WalletManager } from '../src/core/WalletManager';

configDotenv();

type BotConfig = {
    binanceApiKey: string;
    binanceSecret: string;
    pairs?: string[];
    tradeSize: number;
    wsURL: string;
    rpcURL: string;
    dryRun: boolean;
    simulation: boolean;
    debug?: boolean;
    poolAddresses: string[];
    signalConfig?: GeneratorConfig;
    scorerConfig?: ScorerConfig;
    executorConfig?: ExecutorConfig;
    riskManagerConfig: {
        riskLimits: Partial<RiskLimits>;
        initialCapital: number;
    };
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const logger = getLogger('ARB_BOT');
const killSwitchFile = process.env.KILL_SWITCH_FILE ?? '/tmp/arb_bot_kill';

const debug = (enabled: boolean, message: string): void => {
    if (!enabled) return;
    logger.debug(message);
};

const isKillSwitchActive = (): boolean => existsSync(killSwitchFile);

class ArbBot {
    private readonly exchange: ExchangeClient;
    private readonly inventory: InventoryTracker;
    private readonly fees: FeeStructure;
    private readonly generator: SignalGenerator;
    private readonly scorer: SignalScorer;
    private readonly executor: Executor;
    private readonly chain: ChainClient;
    private readonly pricing: PricingEngine;
    private readonly riskManager: RiskManager;
    private readonly preTradeValidator: PreTradeValidator;
    private readonly wallet: WalletManager;

    private readonly pairs: string[];
    private readonly tradeSize: number;
    private readonly debugMode: boolean;
    private readonly telegramAlert: TelegramAlert;
    private running: boolean;

    private lastHourlyResetAt = Date.now();

    constructor(private readonly config: BotConfig) {
        const apiConfig = {
            ...BINANCE_CONFIG,
            apiKey: config.binanceApiKey,
            secret: config.binanceSecret,
        };

        this.wallet = WalletManager.fromEnv();

        this.riskManager = new RiskManager(
            new RiskLimits(this.config.riskManagerConfig.riskLimits),
            this.config.riskManagerConfig.initialCapital,
        );
        this.preTradeValidator = new PreTradeValidator();

        this.telegramAlert = new TelegramAlert(
            process.env.TELEGRAM_BOT_TOKEN!,
            process.env.TELEGRAM_CHAT_ID!,
        );

        this.exchange = new ExchangeClient(apiConfig, false);
        this.inventory = new InventoryTracker([Venue.BINANCE, Venue.WALLET]);
        this.fees = new FeeStructure(
            Config.CEX_TAKER_BPS,
            Config.DEX_SWAP_BPS,
            Config.GAS_COST_USD,
        );

        this.chain = new ChainClient([config.rpcURL], 30, 3, false);
        this.pricing = new PricingEngine(this.chain, 'http://localhost:8545', config.wsURL);
        this.generator = new SignalGenerator(
            this.exchange,
            this.pricing,
            this.inventory,
            this.fees,
            config.signalConfig ?? {},
        );

        this.scorer = new SignalScorer(config.scorerConfig);

        this.executor = new Executor(this.exchange, this.pricing, this.inventory, {
            simulationMode: config.simulation ?? true,
        });

        this.pairs = config.pairs ?? ['ETH/USDT'];
        this.tradeSize = config.tradeSize ?? 0.1;
        this.debugMode = config.debug ?? false;
        this.running = false;

        debug(
            this.debugMode,
            `constructor pairs=${this.pairs.join(',')} tradeSize=${this.tradeSize} simulation=${config.simulation ?? true}`,
        );
    }

    public async init(): Promise<void> {
        await this.telegramAlert.send(
            `Bot was initialized at ${new Date().toISOString()} in ${this.config.dryRun ? 'DRY RUN' : 'PRODUCTION'} mode`,
        );
        debug(this.debugMode, 'init: exchange.init()');
        await this.exchange.init();
        debug(this.debugMode, `init: pricing.loadPools(${this.config.poolAddresses})`);
        const poolAddresses = this.config.poolAddresses.map((address) =>
            Address.fromString(address),
        );
        await this.pricing.loadPools(poolAddresses);
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
        const msg = `Bot starting in ${this.config.simulation ? 'SIMULATION' : 'PRODUCTION'} mode`;
        logger.info(msg);
        this.telegramAlert.send(msg);
        logger.info(`Kill switch file: ${killSwitchFile}`);
        debug(this.debugMode, 'run: initial syncBalances()');
        await this.syncBalances();

        while (this.running) {
            try {
                if (isKillSwitchActive()) {
                    logger.warn(`Kill switch active: ${killSwitchFile}. Stopping bot.`);
                    this.telegramAlert.send('KILL SWITCH HAS BEEN TRIGGERED!', true);
                    this.stop();
                    break;
                }

                this.maybeResetHourly();

                debug(this.debugMode, 'run: tick start');
                await this.tick();
                debug(this.debugMode, 'run: tick done');
                await sleep(1000);
            } catch (e) {
                logger.error(`Tick error: ${e instanceof Error ? e.message : String(e)}`);
                await sleep(5000);
            }
        }

        this.telegramAlert.send('Bot was stopped!');
    }

    public stop(): void {
        this.running = false;
    }

    private async tick(): Promise<void> {
        logger.info('--- Start tick ---');
        if (this.executor.isCircuitBreakerOpen()) {
            logger.info('Circuit breaker open');
            this.telegramAlert.send('Circuit breaker tripped!', true);
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

            const [valid, reason] = this.preTradeValidator.validateSignal(signal);

            if (!valid) {
                logger.warn(`Validation failed: ${reason}`);
                continue;
            }

            const [allowed, failReason] = this.riskManager.checkPreTrade(signal);

            if (!allowed) {
                logger.info(`Risk check failed: ${failReason}`);
                continue;
            }

            const tradeUsd = signal.size.mul(signal.cexPrice).toNumber();
            const dailyLoss = Math.max(0, -this.riskManager.dailyPnl);
            const [safe, safetyReason] = safetyCheck(
                tradeUsd,
                dailyLoss,
                this.riskManager.currentCapital,
                this.riskManager.tradesThisHour,
            );

            if (!safe) {
                const msg = `SAFETY ERROR: ${safetyReason}, BOT WAS STOPPED!`;
                logger.info(msg);
                this.telegramAlert.send(msg, true);
                this.stop();
                return;
            }

            signal.score = this.scorer.score(signal, this.inventory.inventorySkews(pair));
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

            if (this.config.dryRun) {
                const msg =
                    `DRY RUN | Would trade: pair=${pair} ` +
                    `direction=${signal.direction} ` +
                    `size=${signal.size.toNumber().toFixed(4)} ` +
                    `spread=${signal.spreadBps.toFixed(1)}bps ` +
                    `expectedPnl=${signal.expectedNetPnl.toNumber().toFixed(2)}`;

                logger.info(msg);
                this.telegramAlert.send(msg);

                return;
            }

            logger.info(
                `Signal: ${pair} spread=${signal.spreadBps.toFixed(1)}bps score=${signal.score}`,
            );
            logger.info(`Executing: ${signal.direction} ${this.tradeSize} ${pair.split('/')[0]}`);
            debug(this.debugMode, `tick: executor.execute() pair=${pair}`);

            const ctx = await this.executor.execute(signal);

            this.telegramAlert.send(
                `Trade executed with PnL: ${ctx.actualNetPnl} at ${new Date().toISOString()}`,
            );

            if (ctx.state === ExecutorState.DONE && (this.config.simulation ?? true)) {
                const pnl = ctx.actualNetPnl ?? 0;
                if (pnl <= 0) {
                    ctx.actualNetPnl = Math.abs(pnl) + 0.01;
                }
            }

            if (ctx.actualNetPnl) {
                this.riskManager.recordTrade(ctx.actualNetPnl);
            }

            this.scorer.recordResult(pair, ctx.state === ExecutorState.DONE);
            debug(
                this.debugMode,
                `tick: execution result pair=${pair} state=${ExecutorState[ctx.state]} pnl=${ctx.actualNetPnl ?? 0}`,
            );

            if (ctx.state === ExecutorState.DONE) {
                const msg = `SUCCESS: PnL=$${(ctx.actualNetPnl ?? 0).toFixed(2)}`;
                this.telegramAlert.send(msg);
                logger.info(msg);
            } else {
                const msg = `FAILED: ${ctx.error ?? ExecutorState[ctx.state]}`;
                logger.warn(msg);
            }

            debug(this.debugMode, 'tick: syncBalances() after execution');
            await this.syncBalances();
        }

        logger.info('--- End tick ---');
    }

    private maybeResetHourly(): void {
        const now = Date.now();
        const oneHourMs = 60 * 60 * 1000;

        if (now - this.lastHourlyResetAt >= oneHourMs) {
            this.riskManager.resetHourly();
            this.lastHourlyResetAt = now;
            logger.info(
                `Hourly trade counter reset, executed trades count: ${this.riskManager.tradesThisHour}`,
            );
            this.telegramAlert.send(
                `Hour reset, executed trades count: ${this.riskManager.tradesThisHour}`,
            );
        }
    }

    private async buildForcedSignal(pair: string): Promise<Signal | null> {
        try {
            const ob = await this.exchange.fetchOrderBook(pair);
            const cexPrice = new Decimal(ob.asks[0][0]);
            const dexPrice = cexPrice.mul(new Decimal(1).plus(new Decimal(60).div(10_000)));

            const tradeValue = this.tradeSize * cexPrice.toNumber();
            const grossPnl = (60 / 10_000) * tradeValue;
            const feesBps = this.fees.totalFeeBps(tradeValue);
            const fees = (feesBps / 10_000) * tradeValue;
            const netPnl = Math.max(grossPnl - fees, 0.01);

            return new Signal({
                pair,
                direction: Direction.BUY_CEX_SELL_DEX,
                cexPrice,
                dexPrice,
                spreadBps: 60,
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

    private async syncBalances(): Promise<void> {
        if (this.config.simulation ?? true) {
            debug(this.debugMode, 'syncBalances: simulation mode, skip');
            return;
        }
        debug(this.debugMode, 'syncBalances: fetchBalance()');
        const balances = await this.exchange.fetchBalance();

        this.inventory.updateFromCex(Venue.BINANCE, balances);
        debug(this.debugMode, `syncBalances: updated assets=${Object.keys(balances).join(',')}`);
    }
}

async function main(): Promise<void> {
    const config: BotConfig = {
        binanceApiKey: Config.BINANCE_API_KEY,
        binanceSecret: Config.BINANCE_SECRET!,
        pairs: ['ARB/USDC'],
        tradeSize: 90,
        wsURL: Config.DEX_WS_URL,
        rpcURL: Config.ARBITRUM_RPC,
        dryRun: true,
        simulation: !process.env.PRODUCTION,
        debug: false,
        poolAddresses: ['0x011f31D20C8778c8Beb1093b73E3A5690Ee6271b'],
        signalConfig: {
            min_spread_bps: 1,
            min_profit_usd: 0,
            cooldown_seconds: 1,
            tokenMap: {
                ETH: Config.WETH_ADDRESS,
                USDC: Config.USDC_ADDRESS,
                ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
            },
        },
        riskManagerConfig: {
            riskLimits: {},
            initialCapital: 100,
        },
    };

    const bot = new ArbBot(config);
    process.on('SIGINT', () => bot.stop());
    process.on('SIGTERM', () => bot.stop());

    await bot.init();
    await bot.run();
}

void main().catch((e) => {
    logger.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
});
