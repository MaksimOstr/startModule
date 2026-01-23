import { TokenAmount } from './TokenAmount';
import { TransactionReceipt as Web3Receipt } from 'ethers';

export interface TransactionReceiptParams {
    txHash: string;
    blockNumber: number;
    status: boolean;
    gasUsed: bigint;
    effectiveGasPrice: bigint;
    logs: Web3Receipt['logs'];
}

export class TransactionReceipt {
    private _txHash: string;
    private _blockNumber: number;
    private _status: boolean;
    private _gasUsed: bigint;
    private _effectiveGasPrice: bigint;
    private _logs: Web3Receipt['logs'];

    constructor(params: TransactionReceiptParams) {
        this._txHash = params.txHash;
        this._blockNumber = params.blockNumber;
        this._status = params.status;
        this._gasUsed = params.gasUsed;
        this._effectiveGasPrice = params.effectiveGasPrice;
        this._logs = params.logs;
    }

    get txFee(): TokenAmount {
        const feeRaw = this._gasUsed * this._effectiveGasPrice;
        return new TokenAmount(feeRaw, 18, 'ETH');
    }

    get txHash(): string {
        return this._txHash;
    }

    get blockNumber(): number {
        return this._blockNumber;
    }

    get status(): boolean {
        return this._status;
    }

    get gasUsed(): bigint {
        return this._gasUsed;
    }

    get effectiveGasPrice(): bigint {
        return this._effectiveGasPrice;
    }

    get logs(): Web3Receipt['logs'] {
        return this._logs;
    }

    static fromWeb3(receipt: Web3Receipt): TransactionReceipt {
        return new TransactionReceipt({
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            status: receipt.status === 1,
            gasUsed: receipt.gasUsed,
            effectiveGasPrice: receipt.gasPrice,
            logs: receipt.logs,
        });
    }
}
