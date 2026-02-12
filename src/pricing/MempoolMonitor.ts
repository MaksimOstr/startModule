import { ethers } from 'ethers';

export interface ParsedSwap {
    txHash: string;
    router: string;
    dex: string;
    method: string;
    tokenIn: string | null;
    tokenOut: string | null;
    amountIn: bigint;
    minAmountOut: bigint;
    deadline: number;
    sender: string;
    gasPrice: bigint;
    slippageTolerance: number;
}

export class MempoolMonitor {
    private provider: ethers.WebSocketProvider;
    private interfaceV2: ethers.Interface;

    private static readonly SWAP_SELECTORS: Record<string, [string, string]> = {
        '0x38ed1739': ['UniswapV2', 'swapExactTokensForTokens'],
        '0x7ff36ab5': ['UniswapV2', 'swapExactETHForTokens'],
        '0x18cbafe5': ['UniswapV2', 'swapExactTokensForETH'],
        '0x5c11d795': ['UniswapV2', 'swapExactTokensForTokensSupportingFeeOnTransferTokens'],
        '0xb6f9de95': ['UniswapV2', 'swapExactETHForTokensSupportingFeeOnTransferTokens'],
        '0x791ac947': ['UniswapV2', 'swapExactTokensForETHSupportingFeeOnTransferTokens'],
    };

    private static readonly V2_ABI = [
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)',
        'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline)',
        'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)',
        'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)',
        'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline)',
        'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)',
    ];

    constructor(
        private wsUrl: string,
        private callback: (swap: ParsedSwap) => void,
    ) {
        this.provider = new ethers.WebSocketProvider(this.wsUrl);
        this.interfaceV2 = new ethers.Interface(MempoolMonitor.V2_ABI);
    }

    public async start(): Promise<void> {
        this.provider.on('pending', async (txHash: string) => {
            try {
                const tx = await this.provider.getTransaction(txHash);
                if (tx && tx.data && tx.data !== '0x') {
                    const parsed = this.parseTransaction(tx);
                    if (parsed) {
                        this.callback(parsed);
                    }
                }
            } catch {
                return;
            }
        });
    }

    private parseTransaction(tx: ethers.TransactionResponse): ParsedSwap | null {
        const selector = tx.data.substring(0, 10).toLowerCase();
        const mapping = MempoolMonitor.SWAP_SELECTORS[selector];

        if (!mapping) return null;

        try {
            const [dex, method] = mapping;
            const decoded = this.interfaceV2.decodeFunctionData(method, tx.data);

            let tokenIn: string | null = null;
            let tokenOut: string | null = null;
            let amountIn: bigint = 0n;
            let minAmountOut: bigint = 0n;

            const path = decoded.path as string[];
            tokenIn = path[0];
            tokenOut = path[path.length - 1];

            if (method.includes('ETHForTokens')) {
                amountIn = tx.value;
                minAmountOut = decoded.amountOutMin;
            } else {
                amountIn = decoded.amountIn;
                minAmountOut = decoded.amountOutMin;
            }

            const slippageTolerance = this.calculateSlippage();

            return {
                txHash: tx.hash,
                router: tx.to || '',
                dex,
                method,
                tokenIn,
                tokenOut,
                amountIn,
                minAmountOut,
                deadline: Number(decoded.deadline),
                sender: tx.from,
                gasPrice: tx.gasPrice || 0n,
                slippageTolerance,
            };
        } catch {
            return null;
        }
    }

    private calculateSlippage(): number {
        return 0;
    }
}
