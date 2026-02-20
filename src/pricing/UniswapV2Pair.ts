import { ethers } from 'ethers';
import { Address } from '../core/types/Address';
import { TokenAmount } from '../core/types/TokenAmount';
import { ChainClient } from '../chain/ChainClient';
import { TransactionRequest } from '../core/types/TransactionRequest';
import { Token } from './Token';

export class UniswapV2Pair {
    private _address: Address;
    private _token0: Token;
    private _token1: Token;
    private _reserve0: bigint;
    private _reserve1: bigint;
    private _feeBps: bigint;

    constructor(
        address: Address,
        token0: Token,
        token1: Token,
        reserve0: bigint,
        reserve1: bigint,
        feeBps: bigint = 30n,
    ) {
        this._address = address;
        this._token0 = token0;
        this._token1 = token1;
        this._reserve0 = reserve0;
        this._reserve1 = reserve1;
        this._feeBps = feeBps;
    }

    get address(): Address {
        return this._address;
    }

    get token0(): Token {
        return this._token0;
    }

    get token1(): Token {
        return this._token1;
    }

    get reserve0(): bigint {
        return this._reserve0;
    }

    get reserve1(): bigint {
        return this._reserve1;
    }

    get feeBps(): bigint {
        return this._feeBps;
    }

    public getAmountOut(amountIn: bigint, tokenIn: Token): bigint {
        if (amountIn <= 0n) throw new Error('Insufficient input amount');

        const isToken0 = tokenIn.address.checksum === this.token0.address.checksum;
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

        const isToken0Out = tokenOut.address.checksum === this.token0.address.checksum;
        const reserveIn = isToken0Out ? this.reserve1 : this.reserve0;
        const reserveOut = isToken0Out ? this.reserve0 : this.reserve1;

        if (amountOut >= reserveOut) throw new Error('Insufficient liquidity');

        const numerator = reserveIn * amountOut * 10000n;
        const denominator = (reserveOut - amountOut) * (10000n - this.feeBps);

        return numerator / denominator + 1n;
    }

    public getSpotPrice(tokenIn: Token): bigint {
        const SCALE = 10n ** 18n;

        const isToken0 = tokenIn.address.checksum === this.token0.address.checksum;

        const reserveIn = isToken0 ? this.reserve0 : this.reserve1;
        const reserveOut = isToken0 ? this.reserve1 : this.reserve0;

        const decimalsIn = isToken0 ? this.token0.decimals : this.token1.decimals;
        const decimalsOut = isToken0 ? this.token1.decimals : this.token0.decimals;

        if (reserveIn === 0n) return 0n;

        const numerator = reserveOut * 10n ** BigInt(decimalsIn) * SCALE;
        const denominator = reserveIn * 10n ** BigInt(decimalsOut);

        return numerator / denominator;
    }

    public getExecutionPrice(amountIn: bigint, tokenIn: Token): bigint {
        const SCALE = 10n ** 18n;

        if (amountIn === 0n) return 0n;

        const amountOut = this.getAmountOut(amountIn, tokenIn);

        const isToken0 = tokenIn.address.checksum === this.token0.address.checksum;

        const decimalsIn = isToken0 ? this.token0.decimals : this.token1.decimals;
        const decimalsOut = isToken0 ? this.token1.decimals : this.token0.decimals;

        const numerator = amountOut * 10n ** BigInt(decimalsIn) * SCALE;
        const denominator = amountIn * 10n ** BigInt(decimalsOut);

        return numerator / denominator;
    }

    public getPriceImpact(amountIn: bigint, tokenIn: Token): bigint {
        const SCALE = 10n ** 18n;

        const spot = this.getSpotPrice(tokenIn);
        const execution = this.getExecutionPrice(amountIn, tokenIn);

        if (execution >= spot) return 0n;

        return ((spot - execution) * SCALE) / spot;
    }

    public getReserve(address: Address) {
        if (this.token0.address.checksum === address.checksum) {
            return this.reserve0;
        }
        if (this.token1.address.checksum === address.checksum) {
            return this.reserve1;
        }

        throw new Error('Token by provided address not found in the pair');
    }

    public simulateSwap(amountIn: bigint, tokenIn: Token): UniswapV2Pair {
        const amountOut = this.getAmountOut(amountIn, tokenIn);
        const isToken0 = tokenIn.address.checksum === this.token0.address.checksum;

        let newReserve0 = this.reserve0;
        let newReserve1 = this.reserve1;

        if (isToken0) {
            newReserve0 += amountIn;
            if (amountOut > newReserve1) throw new Error('Insufficient liquidity for simulation');
            newReserve1 -= amountOut;
        } else {
            newReserve1 += amountIn;
            if (amountOut > newReserve0) throw new Error('Insufficient liquidity for simulation');
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
            {
                type: 'function',
                name: 'token0',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ name: '', type: 'address' }],
            },
            {
                type: 'function',
                name: 'token1',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ name: '', type: 'address' }],
            },
            {
                type: 'function',
                name: 'getReserves',
                stateMutability: 'view',
                inputs: [],
                outputs: [
                    { name: 'reserve0', type: 'uint112' },
                    { name: 'reserve1', type: 'uint112' },
                    { name: 'blockTimestampLast', type: 'uint32' },
                ],
            },
        ]);

        const tokenInterface = new ethers.Interface([
            {
                type: 'function',
                name: 'name',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ name: '', type: 'string' }],
            },
            {
                type: 'function',
                name: 'decimals',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ name: '', type: 'uint8' }],
            },
        ]);

        const zeroVal = new TokenAmount(0n, 18);
        const reqT0 = new TransactionRequest({
            to: address,
            value: zeroVal,
            data: pairInterface.encodeFunctionData('token0'),
        });
        const reqT1 = new TransactionRequest({
            to: address,
            value: zeroVal,
            data: pairInterface.encodeFunctionData('token1'),
        });
        const reqRes = new TransactionRequest({
            to: address,
            value: zeroVal,
            data: pairInterface.encodeFunctionData('getReserves'),
        });

        try {
            const [rawT0, rawT1, rawRes] = await Promise.all([
                client.call(reqT0),
                client.call(reqT1),
                client.call(reqRes),
            ]);

            const addr0Str = pairInterface.decodeFunctionResult('token0', rawT0)[0];
            const addr1Str = pairInterface.decodeFunctionResult('token1', rawT1)[0];
            const reserves = pairInterface.decodeFunctionResult('getReserves', rawRes);

            const addr0 = new Address(addr0Str);
            const addr1 = new Address(addr1Str);

            const reqName0 = new TransactionRequest({
                to: addr0,
                value: zeroVal,
                data: tokenInterface.encodeFunctionData('name'),
            });
            const reqDec0 = new TransactionRequest({
                to: addr0,
                value: zeroVal,
                data: tokenInterface.encodeFunctionData('decimals'),
            });
            const reqName1 = new TransactionRequest({
                to: addr1,
                value: zeroVal,
                data: tokenInterface.encodeFunctionData('name'),
            });
            const reqDec1 = new TransactionRequest({
                to: addr1,
                value: zeroVal,
                data: tokenInterface.encodeFunctionData('decimals'),
            });

            const [rawName0, rawDec0, rawName1, rawDec1] = await Promise.all([
                client.call(reqName0),
                client.call(reqDec0),
                client.call(reqName1),
                client.call(reqDec1),
            ]);

            const token0 = new Token(
                tokenInterface.decodeFunctionResult('name', rawName0)[0],
                Number(tokenInterface.decodeFunctionResult('decimals', rawDec0)[0]),
                new Address(addr0Str),
            );

            const token1 = new Token(
                tokenInterface.decodeFunctionResult('name', rawName1)[0],
                Number(tokenInterface.decodeFunctionResult('decimals', rawDec1)[0]),
                new Address(addr1Str),
            );

            return new UniswapV2Pair(address, token0, token1, reserves[0], reserves[1]);
        } catch (error) {
            console.error(`Failed to fetch pair data for ${address.checksum}`, error);
            throw error;
        }
    }
}
