import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';

export enum Direction {
    BUY_CEX_SELL_DEX = 'buy_cex_sell_dex',
    BUY_DEX_SELL_CEX = 'buy_dex_sell_cex',
}

export class Signal {
    constructor(
        public signalId: string,
        public pair: string,
        public direction: Direction,
        public cexPrice: Decimal,
        public dexPrice: Decimal,
        public spreadBps: number,
        public size: Decimal,
        public expectedGrossPnl: Decimal,
        public expectedFees: Decimal,
        public expectedNetPnl: Decimal,
        public score: number,
        public timestamp: number,
        public expiry: number,
        public inventoryOk: boolean,
        public withinLimits: boolean,
    ) {}

    static create(
        pair: string,
        direction: Direction,
        params: {
            cexPrice: Decimal.Value;
            dexPrice: Decimal.Value;
            spreadBps: number;
            size: Decimal.Value;
            expectedGrossPnl: Decimal.Value;
            expectedFees: Decimal.Value;
            expectedNetPnl: Decimal.Value;
            score: number;
            expiry: number;
            inventoryOk: boolean;
            withinLimits: boolean;
            timestamp?: number;
        },
    ): Signal {
        const id = `${pair.replace('/', '')}_${randomUUID().slice(0, 8)}`;
        const ts = params.timestamp ?? Date.now() / 1000;

        return new Signal(
            id,
            pair,
            direction,
            new Decimal(params.cexPrice),
            new Decimal(params.dexPrice),
            params.spreadBps,
            new Decimal(params.size),
            new Decimal(params.expectedGrossPnl),
            new Decimal(params.expectedFees),
            new Decimal(params.expectedNetPnl),
            params.score,
            ts,
            params.expiry,
            params.inventoryOk,
            params.withinLimits,
        );
    }

    isValid(): boolean {
        const now = Date.now() / 1000;
        return (
            now < this.expiry &&
            this.inventoryOk &&
            this.withinLimits &&
            this.expectedNetPnl.greaterThan(0) &&
            this.score > 0
        );
    }

    ageSeconds(): number {
        return Date.now() / 1000 - this.timestamp;
    }
}
