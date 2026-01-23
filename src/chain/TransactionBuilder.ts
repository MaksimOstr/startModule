import { ChainClient } from './ChainClient';
import { TokenAmount } from '../core/types/TokenAmount';
import { WalletManager } from '../core/WalletManager';
import { Priority } from './types/GasPrice';
import { TransactionRequest } from '../core/types/TransactionRequest';
import { Address } from '../core/types/Address';
import { TransactionReceipt } from '../core/types/TransactionReceipt';

export class TransactionBuilder {
    private _to?: Address;
    private _value?: TokenAmount;
    private _data?: string;
    private _nonce?: number;
    private _gasLimit?: bigint;
    private _maxFeePerGas?: bigint;
    private _maxPriorityFee?: bigint;

    constructor(
        private client: ChainClient,
        private wallet: WalletManager,
    ) {}

    to(address: Address): this {
        this._to = address;
        return this;
    }

    value(amount: TokenAmount): this {
        this._value = amount;
        return this;
    }

    data(calldata: string): this {
        this._data = calldata;
        return this;
    }

    nonce(n: number): this {
        this._nonce = n;
        return this;
    }

    gasLimit(limit: bigint): this {
        this._gasLimit = limit;
        return this;
    }

    async withGasEstimate(buffer: number = 1.2): Promise<this> {
        const tx = this.build();
        const estimate: bigint = await this.client.estimateGas(tx);

        const scale = 100n;
        const bufferScaled = BigInt(Math.round(buffer * 100));

        const gasLimitWithBuffer = (estimate * bufferScaled) / scale;
        this.gasLimit(gasLimitWithBuffer);

        return this;
    }

    async withGasPrice(priority: Priority = Priority.MEDIUM): Promise<this> {
        const gasPrice = await this.client.getGasPrice();
        this._maxFeePerGas = gasPrice.getMaxFee(priority);
        this._maxPriorityFee = gasPrice.getPriorityFee(priority);
        return this;
    }

    build(): TransactionRequest {
        if (!this._to) throw new Error('Recipient address (to) is missing');

        return new TransactionRequest({
            to: this._to,
            value: this._value ?? new TokenAmount(0n, 0, 'ETH'),
            data: this._data ?? '0x',
            nonce: this._nonce,
            gasLimit: this._gasLimit,
            maxFeePerGas: this._maxFeePerGas,
            maxPriorityFee: this._maxPriorityFee,
            chainId: 11155111,
        });
    }

    async buildAndSign(): Promise<string> {
        const txRequest = this.build();
        return this.wallet.signTransaction(txRequest);
    }

    async send(): Promise<string> {
        const signed = await this.buildAndSign();
        return this.client.sendTransaction(signed);
    }

    async sendAndWait(timeout: number = 120_000): Promise<TransactionReceipt> {
        const txHash = await this.send();
        return this.client.waitForReceipt(txHash, timeout);
    }
}
