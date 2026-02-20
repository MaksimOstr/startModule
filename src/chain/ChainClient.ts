import {
    FeeData,
    JsonRpcProvider,
    TransactionRequest as EtherTransactionRequest,
    TransactionReceipt as EthersTransactionReceipt,
    FetchRequest,
    Contract,
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
import { getLogger } from '../logger';

export class ChainClient {
    private static ERC20_BALANCE_ABI = [
        {
            type: 'function',
            name: 'balanceOf',
            stateMutability: 'view',
            inputs: [{ name: 'owner', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }],
        },
        {
            type: 'function',
            name: 'decimals',
            stateMutability: 'view',
            inputs: [],
            outputs: [{ name: '', type: 'uint8' }],
        },
    ];

    private providers: JsonRpcProvider[];
    private timeout: number;
    private maxRetries: number;
    private enableLogs: boolean;
    private logger = getLogger('ChainClient');
    private tokenDecimalsCache: Map<string, number>;

    constructor(rpcUrls: string[], timeout = 30, maxRetries = 3, enableLogs = true) {
        if (rpcUrls.length === 0) throw new Error('At least one RPC URL is required');
        this.providers = rpcUrls.map((url) => {
            const fetchRequest = new FetchRequest(url);
            fetchRequest.timeout = timeout * 1000;
            return new JsonRpcProvider(fetchRequest);
        });
        this.timeout = timeout;
        this.maxRetries = maxRetries;
        this.enableLogs = enableLogs;
        this.tokenDecimalsCache = new Map();
    }

    getProvider(): JsonRpcProvider {
        return this.providers[0];
    }

    async getBalance(address: Address): Promise<TokenAmount> {
        const balance: bigint = await this.withRetry(
            (provider) => provider.getBalance(address.checksum),
            'getBalance',
        );

        return new TokenAmount(balance, 18, 'ETH');
    }

    getNonce(address: Address, block: string = 'pending') {
        return this.withRetry(
            (provider) => provider.getTransactionCount(address.checksum, block),
            'getNonce',
        );
    }

    getGasPrice(): Promise<GasPrice> {
        return this.withRetry(async (provider) => {
            const fee: FeeData = await provider.getFeeData();

            if (fee.maxFeePerGas === null || fee.maxPriorityFeePerGas === null) {
                throw new RPCError('Cannot fetch fee data from RPC node');
            }

            const baseFee = fee.maxFeePerGas - fee.maxPriorityFeePerGas;

            return new GasPrice(
                baseFee,
                fee.maxPriorityFeePerGas / 2n,
                fee.maxPriorityFeePerGas,
                (fee.maxPriorityFeePerGas * 12n) / 10n,
            );
        }, 'getGasPrice');
    }

    estimateGas(tx: TransactionRequest): Promise<bigint> {
        return this.withRetry((provider) => provider.estimateGas({ ...tx }), 'estimateGas');
    }

    sendTransaction(signedTransaction: string): Promise<string> {
        return this.withRetry(async (provider) => {
            const response = await provider.broadcastTransaction(signedTransaction);
            return response.hash;
        }, 'sendTransaction');
    }

    async waitForReceipt(
        txHash: string,
        timeout: number = 120,
        pollInterval: number = 1.0,
    ): Promise<TransactionReceipt> {
        const start = Date.now();
        this.log(`Start waiting for receipt: ${txHash}, timeout=${timeout}s`);
        while (Date.now() - start < timeout * 1000) {
            const receipt = await this.getReceipt(txHash, false);
            if (receipt) {
                const duration = Date.now() - start;
                this.log(`Receipt received for ${txHash} after ${duration} ms`);
                return receipt;
            }
            await new Promise((r) => setTimeout(r, pollInterval * 1000));
        }

        throw new ChainError(`Transaction ${txHash} not confirmed in time`);
    }

    getTransaction(txHash: string) {
        return this.withRetry((provider) => provider.getTransaction(txHash), 'getTransaction');
    }

    getReceipt(txHash: string, logSuccess: boolean = true): Promise<TransactionReceipt | null> {
        return this.withRetry(
            async (provider) => {
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
            },
            'getReceipt',
            logSuccess,
        );
    }

    call(tx: TransactionRequest, block: string = 'latest'): Promise<string> {
        const txWithBlock: EtherTransactionRequest = {
            to: tx.to.checksum,
            nonce: tx.nonce,
            gasLimit: tx.gasLimit,
            maxFeePerGas: tx.maxFeePerGas,
            maxPriorityFeePerGas: tx.maxPriorityFee,
            chainId: tx.chainId,
            data: tx.data,
            value: tx.value.raw,
            blockTag: block,
        };

        return this.withRetry((provider) => provider.call(txWithBlock), 'call');
    }

    async fetchBalances(
        owner: Address,
        tokenMap: Record<string, string>,
    ): Promise<Record<string, { raw: bigint; decimals: number }>> {
        const result: Record<string, { raw: bigint; decimals: number }> = {};

        for (const [rawSymbol, tokenAddress] of Object.entries(tokenMap)) {
            const symbol = rawSymbol.toUpperCase();
            if (!tokenAddress) continue;

            try {
                const token = new Address(tokenAddress);
                const [raw, decimals] = await Promise.all([
                    this.withRetry(async (provider) => {
                        const contract = new Contract(
                            token.checksum,
                            ChainClient.ERC20_BALANCE_ABI,
                            provider,
                        );
                        return (await contract.balanceOf(owner.checksum)) as bigint;
                    }, `fetchBalance:${symbol}`),
                    this.fetchTokenDecimals(token),
                ]);

                result[symbol] = { raw, decimals };
            } catch {
                result[symbol] = { raw: 0n, decimals: 18 };
            }
        }

        return result;
    }

    private async fetchTokenDecimals(token: Address): Promise<number> {
        const key = token.lower;
        const cached = this.tokenDecimalsCache.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const decimals = await this.withRetry(async (provider) => {
            const contract = new Contract(token.checksum, ChainClient.ERC20_BALANCE_ABI, provider);
            return Number(await contract.decimals());
        }, 'fetchTokenDecimals');

        this.tokenDecimalsCache.set(key, decimals);
        return decimals;
    }

    private async withRetry<T>(
        fn: (provider: JsonRpcProvider) => Promise<T>,
        action: string = 'unknown_action',
        logSuccess: boolean = true,
    ): Promise<T> {
        let lastError: unknown;
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            const provider = this.providers[attempt % this.providers.length];
            const start = Date.now();
            try {
                const result = await fn(provider);
                const duration = Date.now() - start;

                if (logSuccess) {
                    this.log(`[${action}] succeeded in ${duration}ms (attempt ${attempt + 1})`);
                }

                return result;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (err: any) {
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

    private log(message: string): void {
        if (!this.enableLogs) return;
        this.logger.info(message);
    }
}
