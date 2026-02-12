export class FeeStructure {
    constructor(
        public cexTakerBps: number = 10.0,
        public dexSwapBps: number = 30.0,
        public gasCostUsd: number = 5.0,
    ) {}

    totalFeeBps(tradeValueUsd: number): number {
        if (tradeValueUsd <= 0) return 0;
        const gasBps = (this.gasCostUsd / tradeValueUsd) * 10_000;
        return this.cexTakerBps + this.dexSwapBps + gasBps;
    }

    breakevenSpreadBps(tradeValueUsd: number): number {
        return this.totalFeeBps(tradeValueUsd);
    }

    netProfitUsd(spreadBps: number, tradeValueUsd: number): number {
        if (tradeValueUsd <= 0) return 0;
        const gross = (spreadBps / 10_000) * tradeValueUsd;
        const fees = (this.totalFeeBps(tradeValueUsd) / 10_000) * tradeValueUsd;
        return gross - fees;
    }
}
