import { Address } from './Address';
import { TokenAmount } from './TokenAmount';

export interface TransactionRequestParams {
    to: Address;
    value: TokenAmount;
    data: string;
    nonce?: number;
    gasLimit?: number;
    maxFeePerGas?: number;
    maxPriorityFee?: number;
    chainId?: number;
}

export class TransactionRequest {
    private to: Address;
    private value: TokenAmount;
    private data: string;
    private nonce?: number;
    private gasLimit?: number;
    private maxFeePerGas?: number;
    private maxPriorityFee?: number;
    private chainId: number = 1;

    constructor(params: TransactionRequestParams) {
        this.to = params.to;
        this.value = params.value;
        this.data = params.data;
        this.nonce = params.nonce;
        this.gasLimit = params.gasLimit;
        this.maxFeePerGas = params.maxFeePerGas;
        this.maxPriorityFee = params.maxPriorityFee;
        this.chainId = params.chainId ?? 1;
    }

    toDict(): Record<string, unknown> {
        return {
            to: this.to.checksum,
            value: this.value.toString(),
            data: this.data,
            nonce: this.nonce,
            gasLimit: this.gasLimit,
            maxFeePerGas: this.maxFeePerGas,
            maxPriorityFee: this.maxPriorityFee,
            chainId: this.chainId,
        };
    }
}
