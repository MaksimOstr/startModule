import { Signal } from '../strategy/signal';

export type CircuitBreakerConfig = {
    failureThreshold?: number;
    windowSeconds?: number;
    cooldownSeconds?: number;
};

const DEFAULT_CB_CONFIG: Required<CircuitBreakerConfig> = {
    failureThreshold: 3,
    windowSeconds: 300,
    cooldownSeconds: 600,
};

export class CircuitBreaker {
    private config: Required<CircuitBreakerConfig>;
    private failures: number[];
    private trippedAt: number | null;

    constructor(config: CircuitBreakerConfig = {}) {
        this.config = { ...DEFAULT_CB_CONFIG, ...config };
        this.failures = [];
        this.trippedAt = null;
    }

    recordFailure(): void {
        const now = Date.now() / 1000;
        this.failures.push(now);
        const cutoff = now - this.config.windowSeconds;
        this.failures = this.failures.filter((t) => t > cutoff);

        if (this.failures.length >= this.config.failureThreshold) {
            this.trip();
        }
    }

    recordSuccess(): void {}

    private trip(): void {
        this.trippedAt = Date.now() / 1000;
    }

    isOpen(): boolean {
        if (this.trippedAt === null) return false;
        const now = Date.now() / 1000;
        if (now - this.trippedAt > this.config.cooldownSeconds) {
            this.trippedAt = null;
            this.failures = [];
            return false;
        }
        return true;
    }

    timeUntilReset(): number {
        if (this.trippedAt === null) return 0;
        const elapsed = Date.now() / 1000 - this.trippedAt;
        return Math.max(0, this.config.cooldownSeconds - elapsed);
    }
}

export class ReplayProtection {
    private executed: Map<string, number>;
    private ttl: number;

    constructor(ttlSeconds: number = 60) {
        this.executed = new Map();
        this.ttl = ttlSeconds;
    }

    isDuplicate(signal: Signal): boolean {
        this.cleanup();
        return this.executed.has(signal.signalId);
    }

    markExecuted(signal: Signal): void {
        this.executed.set(signal.signalId, Date.now() / 1000);
    }

    private cleanup(): void {
        const cutoff = Date.now() / 1000 - this.ttl;
        for (const [id, ts] of this.executed.entries()) {
            if (ts <= cutoff) this.executed.delete(id);
        }
    }
}
