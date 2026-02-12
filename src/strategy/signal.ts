import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';

export enum Direction {
    BUY_CEX_SELL_DEX = 'buy_cex_sell_dex',
    BUY_DEX_SELL_CEX = 'buy_dex_sell_cex',
}

type SignalParams = {
    signalId?: string;
    pair: string;
    direction: Direction;
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
};

export class Signal {
    public signalId: string;
    public pair: string;
    public direction: Direction;
    public cexPrice: Decimal;
    public dexPrice: Decimal;
    public spreadBps: number;
    public size: Decimal;
    public expectedGrossPnl: Decimal;
    public expectedFees: Decimal;
    public expectedNetPnl: Decimal;
    public score: number;
    public timestamp: number;
    public expiry: number;
    public inventoryOk: boolean;
    public withinLimits: boolean;

    constructor(params: SignalParams) {
        this.signalId =
            params.signalId ?? `${params.pair.replace('/', '')}_${randomUUID().slice(0, 8)}`;
        this.pair = params.pair;
        this.direction = params.direction;
        this.cexPrice = new Decimal(params.cexPrice);
        this.dexPrice = new Decimal(params.dexPrice);
        this.spreadBps = params.spreadBps;
        this.size = new Decimal(params.size);
        this.expectedGrossPnl = new Decimal(params.expectedGrossPnl);
        this.expectedFees = new Decimal(params.expectedFees);
        this.expectedNetPnl = new Decimal(params.expectedNetPnl);
        this.score = params.score;
        this.timestamp = params.timestamp ?? Date.now() / 1000;
        this.expiry = params.expiry;
        this.inventoryOk = params.inventoryOk;
        this.withinLimits = params.withinLimits;
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
