import { Token } from './Token';
import { UniswapV2Pair } from './UniswapV2Pair';

export interface ImpactTableEntry {
    amountIn: bigint;
    amountOut: bigint;
    spotPrice: bigint;
    executionPrice: bigint;
    priceImpactPct: bigint;
}

export interface TrueCostEstimate {
    grossOutput: bigint;
    gasCostEth: bigint;
    gasCostInOutputToken: bigint;
    netOutput: bigint;
    effectivePrice: bigint;
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
                priceImpactPct: priceImpact * 100n,
            };
        });
    }

    public findMaxSizeForImpact(tokenIn: Token, maxImpactPct: bigint): bigint {
        const impactLimit = maxImpactPct * 10n ** 16n;

        let low = 1n;
        const isToken0 = tokenIn.address.checksum === this.pair.token0.address.checksum;
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
        const SCALE = 10n ** 18n;

        const amountOut = this.pair.getAmountOut(amountIn, tokenIn);

        const tokenOut =
            tokenIn.address.checksum === this.pair.token0.address.checksum
                ? this.pair.token1
                : this.pair.token0;

        const gasCostWei = gasEstimate * gasPriceGwei * 1_000_000_000n;

        let gasCostInOutput = 0n;

        const tokenOutName = tokenOut.name.toUpperCase();
        const tokenInName = tokenIn.name.toUpperCase();

        const isOutNative = tokenOutName === 'WETH' || tokenOutName === 'ETH';
        const isInNative = tokenInName === 'WETH' || tokenInName === 'ETH';

        if (isOutNative) {
            gasCostInOutput = gasCostWei;
        } else if (isInNative) {
            try {
                gasCostInOutput = this.pair.getAmountOut(gasCostWei, tokenIn);
            } catch {
                gasCostInOutput = 0n;
            }
        } else {
            gasCostInOutput = 0n;
        }

        const netOutput = amountOut > gasCostInOutput ? amountOut - gasCostInOutput : 0n;

        let effectivePrice = 0n;

        if (amountIn > 0n && netOutput > 0n) {
            const isToken0 = tokenIn.address.checksum === this.pair.token0.address.checksum;
            const decimalsIn = isToken0 ? this.pair.token0.decimals : this.pair.token1.decimals;
            const decimalsOut = isToken0 ? this.pair.token1.decimals : this.pair.token0.decimals;

            const numerator = netOutput * 10n ** BigInt(decimalsIn) * SCALE;
            const denominator = amountIn * 10n ** BigInt(decimalsOut);

            effectivePrice = numerator / denominator;
        }

        return {
            grossOutput: amountOut,
            gasCostEth: gasCostWei,
            gasCostInOutputToken: gasCostInOutput,
            netOutput,
            effectivePrice,
        };
    }
}
