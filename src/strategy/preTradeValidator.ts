import { Signal } from './signal';

type ValidationResult = [boolean, string];

export class PreTradeValidator {
    private priceHistory: Map<string, number[]>;

    constructor() {
        this.priceHistory = new Map();
    }

    public validateSignal(signal: Signal): ValidationResult {
        // Price sanity
        if (signal.cexPrice.lte(0)) {
            return [false, 'Invalid CEX price'];
        }

        if (signal.dexPrice.lte(0)) {
            return [false, 'Invalid DEX price'];
        }

        // Spread sanity (500 bps is probably an error)
        if (signal.spreadBps > 500) {
            return [false, `Spread ${signal.spreadBps}bps too high - likely bad data`];
        }

        // Timestamp freshness
        const signalAge = signal.ageSeconds();
        if (signalAge > 5) {
            return [false, `Signal too old: ${signalAge.toFixed(1)}s`];
        }

        // Size sanity
        if (signal.size.lte(0)) {
            return [false, 'Invalid trade size'];
        }

        return [true, 'OK'];
    }

    public validatePriceFeed(price: number, pair: string): ValidationResult {
        const recentAvg = this.getRecentAverage(pair);

        if (recentAvg > 0) {
            const deviation = Math.abs(price - recentAvg) / recentAvg;
            if (deviation > 0.05) {
                return [
                    false,
                    `Price ${price} deviates ${(deviation * 100).toFixed(1)}% from recent avg`,
                ];
            }
        }

        return [true, 'OK'];
    }

    private getRecentAverage(pair: string): number {
        const history = this.priceHistory.get(pair.toUpperCase());
        if (!history || history.length === 0) return 0;

        const sum = history.reduce((acc, value) => acc + value, 0);
        return sum / history.length;
    }
}
