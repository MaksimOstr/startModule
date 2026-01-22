import {
    FeeData,
    JsonRpcProvider,
    TransactionRequest as EtherTransactionRequest,
    TransactionReceipt as EthersTransactionReceipt,
    FetchRequest,
} from 'ethers';
import { Address } from '../core/types/Address';
import { TokenAmount } from '../core/types/TokenAmount';
import { TransactionReceipt } from '../core/types/TransactionReceipt';
import { GasPrice } from './types/GasPrice';
import { TransactionRequest } from '../core/types/TransactionRequest';
import {
    ChainError,
    InsufficientFunds,
    NonceTooLow,
    ReplacementUnderpriced,
    RPCError,
} from './Errors';

export class ChainClient {
    private providers: JsonRpcProvider[];
    private timeout: number;
    private maxRetries: number;

    constructor(rpcUrls: string[], timeout = 30, maxRetries = 3) {
        if (rpcUrls.length === 0) throw new Error('At least one RPC URL is required');
        this.providers = rpcUrls.map((url) => {
            const fetchRequest = new FetchRequest(url);
            fetchRequest.timeout = timeout * 1000;
            return new JsonRpcProvider(fetchRequest);
        });
        this.timeout = timeout;
        this.maxRetries = maxRetries;
    }

    async getBalance(address: Address): Promise<TokenAmount> {
        const balance: bigint = await this.withRetry((provider) =>
            provider.getBalance(address.checksum),
        );

        return new TokenAmount(balance, 18, 'ETH');
    }

    getNonce(address: Address, block: string = 'pending') {
        return this.withRetry((provider) => provider.getTransactionCount(address.checksum, block));
    }

    getGasPrice(): Promise<GasPrice> {
        return this.withRetry(async (provider) => {
            const fee: FeeData = await provider.getFeeData();

            if (!fee.maxFeePerGas || !fee.maxPriorityFeePerGas) {
                throw new RPCError('Cannot fetch fee data from RPC node');
            }

            const baseFee = fee.maxFeePerGas - fee.maxPriorityFeePerGas;

            return new GasPrice(
                baseFee,
                fee.maxPriorityFeePerGas / 2n,
                fee.maxPriorityFeePerGas,
                (fee.maxPriorityFeePerGas * 12n) / 10n,
            );
        });
    }

    estimateGas(tx: TransactionRequest): Promise<bigint> {
        return this.withRetry((provider) => provider.estimateGas({ ...tx }));
    }

    sendTransaction(signedTransaction: string): Promise<string> {
        return this.withRetry(async (provider) => {
            const response = await provider.broadcastTransaction(signedTransaction);
            return response.hash;
        });
    }

    async waitForReceipt(
        txHash: string,
        timeout: number = 120,
        pollInterval: number = 1.0,
    ): Promise<TransactionReceipt> {
        const start = Date.now();
        console.log(`[ChainClient] Start waiting for receipt: ${txHash}, timeout=${timeout}s`);
        while (Date.now() - start < timeout * 1000) {
            const receipt = await this.getReceipt(txHash);
            if (receipt) {
                const duration = Date.now() - start;
                console.log(`[ChainClient] Receipt received for ${txHash} after ${duration} ms`);
                return receipt;
            }
            await new Promise((r) => setTimeout(r, pollInterval * 1000));
        }

        throw new ChainError(`Transaction ${txHash} not confirmed in time`);
    }

    getTransaction(txHash: string) {
        return this.withRetry((provider) => provider.getTransaction(txHash));
    }

    getReceipt(txHash: string): Promise<TransactionReceipt | null> {
        return this.withRetry(async (provider) => {
            const receipt: EthersTransactionReceipt | null =
                await provider.getTransactionReceipt(txHash);

            if (!receipt) return null;

            return new TransactionReceipt({
                txHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                status: receipt.status === 1,
                gasUsed: receipt.gasUsed,
                effectiveGasPrice: receipt.gasPrice,
                logs: receipt.logs,
            });
        });
    }

    call(tx: TransactionRequest, block: string = 'latest') {
        const txWithBlock: EtherTransactionRequest = {
            ...tx,
            blockTag: block,
        };

        return this.withRetry((provider) => provider.call(txWithBlock));
    }

    private async withRetry<T>(fn: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
        let lastError: unknown;
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            const provider = this.providers[attempt % this.providers.length];
            const start = Date.now();
            try {
                const result = await fn(provider);
                const duration = Date.now() - start;

                console.log(`[ChainClient] Attempt ${attempt + 1} succeeded in ${duration}ms`);

                return result;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (err: any) {
                const duration = Date.now() - start;
                console.error(
                    `[ChainClient] Attempt ${attempt + 1} failed in ${duration}ms: ${err?.message ?? err}`,
                );
                lastError = err;

                const code = err?.code;
                const message = err?.message;

                if (code === 'INSUFFICIENT_FUNDS' || message.includes('insufficient funds')) {
                    throw new InsufficientFunds(err.message);
                }

                if (code === 'NONCE_EXPIRED' || message.includes('nonce too low')) {
                    throw new NonceTooLow(err.message);
                }

                if (
                    code === 'REPLACEMENT_UNDERPRICED' ||
                    message.includes('replacement transaction underpriced')
                ) {
                    throw new ReplacementUnderpriced(err.message);
                }

                if (code === 'CALL_EXCEPTION' || message.includes('execution reverted')) {
                    throw new RPCError(`Execution Reverted: ${message}`);
                }

                if (attempt < this.maxRetries - 1) {
                    const sleepTime = 2 ** attempt * 500 + Math.random() * 500;
                    await new Promise((r) => setTimeout(r, sleepTime));
                }
            }
        }

        throw new RPCError(
            `RPC call failed after ${this.maxRetries} attempts: ${lastError}`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (lastError as any)?.code,
        );
    }
}
