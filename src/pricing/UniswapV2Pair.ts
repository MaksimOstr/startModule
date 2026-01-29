import { ethers, formatUnits } from 'ethers';
import { Address } from '../core/types/Address';
import { TokenAmount } from '../core/types/TokenAmount';
import { Token } from './Token';
import { ChainClient } from '../chain/ChainClient';
import { TransactionRequest } from '../core/types/TransactionRequest';

export class UniswapV2Pair {
    public readonly address: Address;
    public readonly token0: Token;
    public readonly token1: Token;
    private readonly reserve0: bigint;
    private readonly reserve1: bigint;
    private readonly feeBps: bigint;

    constructor(
        address: Address,
        token0: Token,
        token1: Token,
        reserve0: bigint,
        reserve1: bigint,
        feeBps: bigint = 30n,
    ) {
        this.address = address;
        this.token0 = token0;
        this.token1 = token1;
        this.reserve0 = reserve0;
        this.reserve1 = reserve1;
        this.feeBps = feeBps;
    }

    public getAmountOut(amountIn: bigint, tokenIn: Token): bigint {
        if (amountIn <= 0n) throw new Error('Insufficient input amount');

        const isToken0 = tokenIn.name === this.token0.name;
        const reserveIn = isToken0 ? this.reserve0 : this.reserve1;
        const reserveOut = isToken0 ? this.reserve1 : this.reserve0;

        if (reserveIn <= 0n || reserveOut <= 0n) throw new Error('Insufficient liquidity');

        const amountInWithFee = amountIn * (10000n - this.feeBps);
        const numerator = amountInWithFee * reserveOut;
        const denominator = reserveIn * 10000n + amountInWithFee;

        return numerator / denominator;
    }

    public getAmountIn(amountOut: bigint, tokenOut: Token): bigint {
        if (amountOut <= 0n) throw new Error('Insufficient output amount');

        const isToken0Out = tokenOut.name === this.token0.name;
        const reserveIn = isToken0Out ? this.reserve1 : this.reserve0;
        const reserveOut = isToken0Out ? this.reserve0 : this.reserve1;

        if (amountOut >= reserveOut) throw new Error('Insufficient liquidity');

        const numerator = reserveIn * amountOut * 10000n;
        const denominator = (reserveOut - amountOut) * (10000n - this.feeBps);

        return numerator / denominator + 1n;
    }

    public getSpotPrice(tokenIn: Token): number {
        const isToken0 = tokenIn.name === this.token0.name;

        const reserveIn = isToken0 ? this.reserve0 : this.reserve1;
        const reserveOut = isToken0 ? this.reserve1 : this.reserve0;

        const tokenInObj = isToken0 ? this.token0 : this.token1;
        const tokenOutObj = isToken0 ? this.token1 : this.token0;

        if (reserveIn === 0n) return 0;

        const rIn = parseFloat(formatUnits(reserveIn, tokenInObj.decimals));
        const rOut = parseFloat(formatUnits(reserveOut, tokenOutObj.decimals));
        return rOut / rIn;
    }

    public getExecutionPrice(amountIn: bigint, tokenIn: Token): number {
        const amountOut = this.getAmountOut(amountIn, tokenIn);

        const isToken0 = tokenIn.name === this.token0.name;
        const decimalsIn = isToken0 ? this.token0.decimals : this.token1.decimals;
        const decimalsOut = isToken0 ? this.token1.decimals : this.token0.decimals;

        const valIn = parseFloat(formatUnits(amountIn, decimalsIn));
        const valOut = parseFloat(formatUnits(amountOut, decimalsOut));

        if (valIn === 0) return 0;
        return valOut / valIn;
    }

    public getPriceImpact(amountIn: bigint, tokenIn: Token): number {
        const spot = this.getSpotPrice(tokenIn);
        const execution = this.getExecutionPrice(amountIn, tokenIn);

        if (spot === 0) return 0;
        return (spot - execution) / spot;
    }

    public simulateSwap(amountIn: bigint, tokenIn: Token): UniswapV2Pair {
        const amountOut = this.getAmountOut(amountIn, tokenIn);
        const isToken0 = tokenIn.name === this.token0.name;

        let newReserve0 = this.reserve0;
        let newReserve1 = this.reserve1;

        if (isToken0) {
            newReserve0 += amountIn;
            newReserve1 -= amountOut;
        } else {
            newReserve1 += amountIn;
            newReserve0 -= amountOut;
        }

        return new UniswapV2Pair(
            this.address,
            this.token0,
            this.token1,
            newReserve0,
            newReserve1,
            this.feeBps,
        );
    }

    static async fromChain(address: Address, client: ChainClient): Promise<UniswapV2Pair> {
        const pairInterface = new ethers.Interface([
            'function token0() external view returns (address)',
            'function token1() external view returns (address)',
            'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
        ]);

        const reqT0 = new TransactionRequest({
            to: address,
            value: new TokenAmount(0n, 18),
            data: pairInterface.encodeFunctionData('token0'),
        });

        const reqT1 = new TransactionRequest({
            to: address,
            value: new TokenAmount(0n, 18),
            data: pairInterface.encodeFunctionData('token1'),
        });

        const reqRes = new TransactionRequest({
            to: address,
            value: new TokenAmount(0n, 18),
            data: pairInterface.encodeFunctionData('getReserves'),
        });

        try {
            const [rawT0, rawT1, rawRes] = await Promise.all([
                client.call(reqT0),
                client.call(reqT1),
                client.call(reqRes),
            ]);

            const decodedToken0 = pairInterface.decodeFunctionResult('token0', rawT0)[0];
            const decodedToken1 = pairInterface.decodeFunctionResult('token1', rawT1)[0];
            const decodedReserves = pairInterface.decodeFunctionResult('getReserves', rawRes);

            return new UniswapV2Pair(
                address,
                decodedToken0,
                decodedToken1,
                decodedReserves[0],
                decodedReserves[1],
            );
        } catch (error) {
            console.error(`Failed to fetch pair data for ${address.checksum}`, error);
            throw error;
        }
    }
}
