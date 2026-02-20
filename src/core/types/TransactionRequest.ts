import { Config } from '../../config';
import { Address } from './Address';
import { TokenAmount } from './TokenAmount';

export interface TransactionRequestParams {
    to: Address;
    value: TokenAmount;
    data: string;
    nonce?: number;
    gasLimit?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFee?: bigint;
    chainId?: number;
}

export class TransactionRequest {
    private _to: Address;
    private _value: TokenAmount;
    private _data: string;
    private _nonce?: number;
    private _gasLimit?: bigint;
    private _maxFeePerGas?: bigint;
    private _maxPriorityFee?: bigint;
    private _chainId?: number;

    constructor(params: TransactionRequestParams) {
        this._to = params.to;
        this._value = params.value;
        this._data = params.data;
        this._nonce = params.nonce;
        this._gasLimit = params.gasLimit;
        this._maxFeePerGas = params.maxFeePerGas;
        this._maxPriorityFee = params.maxPriorityFee;
        this._chainId = params.chainId ?? Config.CHAIN_ID;
    }

    get to(): Address {
        return this._to;
    }
    set to(value: Address) {
        this._to = value;
    }

    get value(): TokenAmount {
        return this._value;
    }
    set value(amount: TokenAmount) {
        this._value = amount;
    }

    get data(): string {
        return this._data;
    }
    set data(data: string) {
        this._data = data;
    }

    get nonce(): number | undefined {
        return this._nonce;
    }
    set nonce(n: number | undefined) {
        this._nonce = n;
    }

    get gasLimit(): bigint | undefined {
        return this._gasLimit;
    }
    set gasLimit(limit: bigint | undefined) {
        this._gasLimit = limit;
    }

    get maxFeePerGas(): bigint | undefined {
        return this._maxFeePerGas;
    }
    set maxFeePerGas(fee: bigint | undefined) {
        this._maxFeePerGas = fee;
    }

    get maxPriorityFee(): bigint | undefined {
        return this._maxPriorityFee;
    }
    set maxPriorityFee(fee: bigint | undefined) {
        this._maxPriorityFee = fee;
    }

    get chainId(): number | undefined {
        return this._chainId;
    }
    set chainId(id: number | undefined) {
        this._chainId = id;
    }

    toDict(): Record<string, unknown> {
        return {
            to: this._to.checksum,
            value: this._value.toString(),
            data: this._data,
            nonce: this._nonce,
            gasLimit: this._gasLimit,
            maxFeePerGas: this._maxFeePerGas,
            maxPriorityFee: this._maxPriorityFee,
            chainId: this._chainId,
        };
    }
}
