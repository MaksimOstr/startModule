export enum Priority {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
}

export class GasPrice {
    private _baseFee: bigint;
    private _priorityFeeLow: bigint;
    private _priorityFeeMedium: bigint;
    private _priorityFeeHigh: bigint;

    constructor(
        baseFee: bigint,
        priorityFeeLow: bigint,
        priorityFeeMedium: bigint,
        priorityFeeHigh: bigint,
    ) {
        this._baseFee = baseFee;
        this._priorityFeeLow = priorityFeeLow;
        this._priorityFeeMedium = priorityFeeMedium;
        this._priorityFeeHigh = priorityFeeHigh;
    }

    get baseFee() {
        return this._baseFee;
    }

    get priorityFeeLow() {
        return this._priorityFeeLow;
    }

    get priorityFeeMedium() {
        return this._priorityFeeMedium;
    }

    get priorityFeeHigh() {
        return this._priorityFeeHigh;
    }

    getPriorityFee(priority: Priority = Priority.MEDIUM): bigint {
        switch (priority) {
            case Priority.LOW:
                return this.priorityFeeLow;
            case Priority.MEDIUM:
                return this.priorityFeeMedium;
            case Priority.HIGH:
                return this.priorityFeeHigh;
        }
    }

    getMaxFee(priority: Priority = Priority.MEDIUM, buffer: number = 1.2): bigint {
        const priorityFee = this.getPriorityFee(priority);

        const scale = 100n;
        const bufferBigInt = BigInt(Math.round(buffer * 100));

        return (this.baseFee * bufferBigInt) / scale + priorityFee;
    }
}
