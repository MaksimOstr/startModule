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
    private txHash: string;
    private blockNumber: number;
    private status: boolean;
    private gasUsed: bigint;
    private effectiveGasPrice: bigint;
    private logs: Web3Receipt['logs'];

    constructor(params: TransactionReceiptParams) {
        this.txHash = params.txHash;
        this.blockNumber = params.blockNumber;
        this.status = params.status;
        this.gasUsed = params.gasUsed;
        this.effectiveGasPrice = params.effectiveGasPrice;
        this.logs = params.logs;
    }

    get txFee(): TokenAmount {
        const feeRaw = this.gasUsed * this.effectiveGasPrice;
        return new TokenAmount(feeRaw, 18, 'ETH');
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
