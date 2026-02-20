import { Signal } from './signal';

export class RiskLimits {
    // Per-trade limits
    public maxTradeUsd = 20.0;
    public maxTradePct = 0.2;

    // Position limits
    public maxPositionPerToken = 30.0;
    public maxOpenPositions = 1;

    // Loss limits
    public maxLossPerTrade = 5.0;
    public maxDailyLoss = 15.0;
    public maxDrawdownPct = 0.2;

    // Frequency limits
    public maxTradesPerHour = 20;
    public consecutiveLossLimit = 3;

    constructor(overrides: Partial<RiskLimits> = {}) {
        Object.assign(this, overrides);
    }
}

type PreTradeResult = [boolean, string];

export class RiskManager {
    public limits: RiskLimits;
    public initialCapital: number;
    public peakCapital: number;
    public currentCapital: number;
    public dailyPnl: number;
    public tradesThisHour: number;
    public consecutiveLosses: number;

    constructor(limits: RiskLimits, initialCapital: number) {
        this.limits = limits;
        this.initialCapital = initialCapital;
        this.peakCapital = initialCapital;
        this.currentCapital = initialCapital;
        this.dailyPnl = 0;
        this.tradesThisHour = 0;
        this.consecutiveLosses = 0;
    }

    public checkPreTrade(signal: Signal): PreTradeResult {
        const tradeValue = signal.size.mul(signal.cexPrice).toNumber();

        if (tradeValue > this.limits.maxTradeUsd) {
            return [false, `Trade ${tradeValue.toFixed(2)} exceeds max ${this.limits.maxTradeUsd}`];
        }

        if (tradeValue > this.currentCapital * this.limits.maxTradePct) {
            return [
                false,
                `Trade exceeds ${(this.limits.maxTradePct * 100).toFixed(0)}% of capital`,
            ];
        }

        // Daily loss limit
        if (this.dailyPnl <= -this.limits.maxDailyLoss) {
            return [false, `Daily loss limit reached: ${this.dailyPnl.toFixed(2)}`];
        }

        // Drawdown limit
        const drawdown =
            this.peakCapital > 0 ? (this.peakCapital - this.currentCapital) / this.peakCapital : 0;
        if (drawdown >= this.limits.maxDrawdownPct) {
            return [false, `Drawdown ${(drawdown * 100).toFixed(2)}% exceeds limit`];
        }

        // Consecutive losses
        if (this.consecutiveLosses >= this.limits.consecutiveLossLimit) {
            return [false, `Consecutive loss limit (${this.consecutiveLosses}) reached`];
        }

        // Frequency
        if (this.tradesThisHour >= this.limits.maxTradesPerHour) {
            return [false, 'Hourly trade limit reached'];
        }

        return [true, 'OK'];
    }

    public recordTrade(pnl: number): void {
        this.dailyPnl += pnl;
        this.currentCapital += pnl;
        this.peakCapital = Math.max(this.peakCapital, this.currentCapital);
        this.tradesThisHour += 1;

        if (pnl < 0) {
            this.consecutiveLosses += 1;
        } else {
            this.consecutiveLosses = 0;
        }
    }

    public resetDaily(): void {
        this.dailyPnl = 0;
        this.tradesThisHour = 0;
        this.consecutiveLosses = 0;
    }

    public resetHourly(): void {
        this.tradesThisHour = 0;
    }
}
