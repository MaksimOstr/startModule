import { Signal } from './signal';

export type HistoryRecord = { pair: string; success: boolean };

export interface ScorerConfig {
    spreadWeight?: number;
    liquidityWeight?: number;
    inventoryWeight?: number;
    historyWeight?: number;
    excellentSpreadBps?: number;
    minSpreadBps?: number;
}

export type InventorySkew = {
    token: string;
    status?: string; // e.g., 'RED' | 'YELLOW' | 'GREEN'
};

const DEFAULT_CONFIG: Required<ScorerConfig> = {
    spreadWeight: 0.4,
    liquidityWeight: 0.2,
    inventoryWeight: 0.2,
    historyWeight: 0.2,
    excellentSpreadBps: 100,
    minSpreadBps: 30,
};

export class SignalScorer {
    private config: Required<ScorerConfig>;
    private recentResults: HistoryRecord[];

    constructor(config: ScorerConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.recentResults = [];
    }

    public score(signal: Signal, inventoryState: InventorySkew[]): number {
        const scores = {
            spread: this.scoreSpread(signal.spreadBps),
            liquidity: 80,
            inventory: this.scoreInventory(signal, inventoryState),
            history: this.scoreHistory(signal.pair),
        };

        const weighted =
            scores.spread * this.config.spreadWeight +
            scores.liquidity * this.config.liquidityWeight +
            scores.inventory * this.config.inventoryWeight +
            scores.history * this.config.historyWeight;

        return Math.round(Math.max(0, Math.min(100, weighted)) * 10) / 10;
    }

    private scoreSpread(spreadBps: number): number {
        if (spreadBps <= this.config.minSpreadBps) return 0;
        if (spreadBps >= this.config.excellentSpreadBps) return 100;

        const range = this.config.excellentSpreadBps - this.config.minSpreadBps;
        return ((spreadBps - this.config.minSpreadBps) / range) * 100;
    }

    private scoreInventory(signal: Signal, skews: InventorySkew[]): number {
        const base = signal.pair.split('/')[0];
        const relevant = skews.filter((s) => s.token === base);

        if (relevant.some((s) => s.status?.toUpperCase() === 'RED')) {
            return 20;
        }

        return 60;
    }

    private scoreHistory(pair: string): number {
        const results = this.recentResults.filter((r) => r.pair === pair).slice(-20);
        if (results.length < 3) return 50;

        const successRate =
            results.reduce((acc, r) => acc + (r.success ? 1 : 0), 0) / results.length;
        return successRate * 100;
    }

    public recordResult(pair: string, success: boolean): void {
        this.recentResults.push({ pair, success });
        if (this.recentResults.length > 100) {
            this.recentResults = this.recentResults.slice(-100);
        }
    }

    public applyDecay(signal: Signal): number {
        const age = signal.ageSeconds();
        const ttl = signal.expiry - signal.timestamp;
        const decayFactor = Math.max(0, 1 - (age / ttl) * 0.5);
        return signal.score * decayFactor;
    }
}
