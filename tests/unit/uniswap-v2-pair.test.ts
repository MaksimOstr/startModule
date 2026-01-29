import { Address } from '../../src/core/types/Address';
import { Token } from '../../src/pricing/Token';
import { UniswapV2Pair } from '../../src/pricing/UniswapV2Pair';
import { parseUnits } from 'ethers';

describe('UniswapV2Pair', () => {
    const ETH = new Token(
        'Ethereum',
        18,
        new Address('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
    );
    const USDC = new Token(
        'USD Coin',
        6,
        new Address('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    );
    const PAIR_ADDR = new Address('0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc');

    const createPair = (res0: bigint, res1: bigint) => {
        return new UniswapV2Pair(PAIR_ADDR, ETH, USDC, res0, res1, 30n);
    };

    describe('test_get_amount_out_basic', () => {
        it('1000 ETH / 2M USDC pool, buy with 2000 USDC', () => {
            const reserveETH = parseUnits('1000', 18);
            const reserveUSDC = parseUnits('2000000', 6);

            const pair = new UniswapV2Pair(PAIR_ADDR, ETH, USDC, reserveETH, reserveUSDC);

            const usdcIn = parseUnits('2000', 6);
            const ethOut = pair.getAmountOut(usdcIn, USDC);
            const expectedMin = parseUnits('0.99', 18);
            const expectedMax = parseUnits('1', 18);

            expect(ethOut).toBeLessThan(expectedMax);
            expect(ethOut).toBeGreaterThan(expectedMin);
            expect(typeof ethOut).toBe('bigint');
        });
    });

    describe('test_get_amount_out_matches_solidity', () => {
        it('matches exact Solidity output for 0.3% fee', () => {
            const pair = createPair(1000n, 1000n);
            const out = pair.getAmountOut(100n, ETH);
            expect(out).toBe(90n);
        });

        it('matches getAmountIn reverse calculation (Solidity style)', () => {
            const pair = createPair(parseUnits('100', 18), parseUnits('1000', 6));
            const amountOut = parseUnits('10', 6);

            const amountIn = pair.getAmountIn(amountOut, USDC);
            const backToAmountOut = pair.getAmountOut(amountIn, ETH);

            expect(backToAmountOut).toBeGreaterThanOrEqual(amountOut);
        });
    });

    describe('test_integer_math_no_floats', () => {
        it('handles huge numbers without losing precision (BigInt check)', () => {
            const hugeReserve = 10n ** 30n;
            const amountIn = 10n ** 20n;
            const pair = createPair(hugeReserve, hugeReserve);

            const out = pair.getAmountOut(amountIn, ETH);

            expect(typeof out).toBe('bigint');

            expect(out).toBeGreaterThan(0n);
            expect(out).toBeLessThan(amountIn);
        });
    });

    describe('test_swap_is_immutable', () => {
        it('simulateSwap does not modify the original instance', () => {
            const reserve0Before = parseUnits('10', 18);
            const reserve1Before = parseUnits('100', 18);
            const pair = createPair(reserve0Before, reserve1Before);

            const amountIn = parseUnits('1', 18);
            const newPair = pair.simulateSwap(amountIn, ETH);

            expect(pair.reserve0).toBe(reserve0Before);
            expect(pair.reserve1).toBe(reserve1Before);

            expect(newPair.reserve0).toBe(reserve0Before + amountIn);
            expect(newPair.reserve1).toBeLessThan(reserve1Before);
            expect(newPair).not.toBe(pair);
        });
    });

    describe('test_token_ordering', () => {
        it('correctly identifies which reserve to use based on token address', () => {
            const pair = createPair(100n, 200n);

            const outETH = pair.getAmountOut(10n, USDC);
            const outUSDC = pair.getAmountOut(10n, ETH);

            expect(outETH).not.toBe(outUSDC);
        });
    });
});
