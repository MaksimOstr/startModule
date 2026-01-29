import { formatUnits, parseUnits } from 'ethers';
import { Token } from './Token';
import { UniswapV2Pair } from './UniswapV2Pair';

export interface ImpactTableEntry {
    amountIn: bigint;
    amountOut: bigint;
    spotPrice: number;
    executionPrice: number;
    priceImpactPct: number;
}

export interface TrueCostEstimate {
    grossOutput: bigint;
    gasCostEth: bigint;
    gasCostInOutputToken: bigint;
    netOutput: bigint;
    effectivePrice: number;
}

export class PriceImpactAnalyzer {
    private pair: UniswapV2Pair;

    constructor(pair: UniswapV2Pair) {
        this.pair = pair;
    }

    public generateImpactTable(tokenIn: Token, sizes: bigint[]): ImpactTableEntry[] {
        return sizes.map((amountIn) => {
            const amountOut = this.pair.getAmountOut(amountIn, tokenIn);
            const spotPrice = this.pair.getSpotPrice(tokenIn);
            const executionPrice = this.pair.getExecutionPrice(amountIn, tokenIn);
            const priceImpact = this.pair.getPriceImpact(amountIn, tokenIn);

            return {
                amountIn,
                amountOut,
                spotPrice,
                executionPrice,
                priceImpactPct: priceImpact * 100,
            };
        });
    }

    public findMaxSizeForImpact(tokenIn: Token, maxImpactPct: number): bigint {
        const impactLimit = maxImpactPct / 100;
        let low = 1n;

        const isToken0 = tokenIn.name === this.pair.token0.name;
        const reserveIn = isToken0 ? this.pair.reserve0 : this.pair.reserve1;

        let high = reserveIn;
        let bestSize = 0n;

        for (let i = 0; i < 100; i++) {
            const mid = (low + high) / 2n;
            if (mid <= 0n) break;

            try {
                const impact = this.pair.getPriceImpact(mid, tokenIn);

                if (impact <= impactLimit) {
                    bestSize = mid;
                    low = mid + 1n;
                } else {
                    high = mid - 1n;
                }
            } catch {
                high = mid - 1n;
            }

            if (low > high) break;
        }

        return bestSize;
    }

    public estimateTrueCost(
        amountIn: bigint,
        tokenIn: Token,
        gasPriceGwei: bigint,
        gasEstimate: bigint = 150000n,
    ): TrueCostEstimate {
        const amountOut = this.pair.getAmountOut(amountIn, tokenIn);
        const tokenOut =
            tokenIn.name === this.pair.token0.name ? this.pair.token1 : this.pair.token0;

        const gasCostWei = gasEstimate * gasPriceGwei * 1000000000n;

        let gasCostInOutput = 0n;

        const tokenOutName = tokenOut.name.toUpperCase();
        const tokenInName = tokenIn.name.toUpperCase();

        if (tokenOutName === 'WETH' || tokenOutName === 'ETH') {
            gasCostInOutput = gasCostWei;
        } else if (tokenInName === 'WETH' || tokenInName === 'ETH') {
            try {
                gasCostInOutput = this.pair.getAmountOut(gasCostWei, tokenIn);
            } catch {
                gasCostInOutput = 0n;
            }
        } else {
            try {
                const oneOutputUnit = parseUnits('1', tokenOut.decimals);
                const ethNeeded = this.pair.getAmountIn(oneOutputUnit, tokenIn);
                gasCostInOutput = (gasCostWei * oneOutputUnit) / ethNeeded;
            } catch {
                gasCostInOutput = 0n;
            }
        }

        const netOutput = amountOut > gasCostInOutput ? amountOut - gasCostInOutput : 0n;

        const amountInFloat = parseFloat(formatUnits(amountIn, tokenIn.decimals));
        const netOutputFloat = parseFloat(formatUnits(netOutput, tokenOut.decimals));

        const effectivePrice = amountInFloat > 0 ? netOutputFloat / amountInFloat : 0;

        return {
            grossOutput: amountOut,
            gasCostEth: gasCostWei,
            gasCostInOutputToken: gasCostInOutput,
            netOutput: netOutput,
            effectivePrice: effectivePrice,
        };
    }
}
