import { Address } from '../../src/core/types/Address';
import { Token } from '../../src/pricing/Token';
import { UniswapV2Pair } from '../../src/pricing/UniswapV2Pair';
import { Route } from '../../src/pricing/Route';
import { RouteFinder } from '../../src/pricing/RouteFinder';
import { parseUnits } from 'ethers';

describe('RouteFinder', () => {
    const WETH = new Token('WETH', 18, new Address('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'));
    const USDC = new Token('USDC', 6, new Address('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'));
    const SHIB = new Token('SHIB', 18, new Address('0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE'));

    const createPool = (t0: Token, t1: Token, r0: bigint, r1: bigint) => {
        const randomAddr = new Address(
            '0x' + Math.random().toString(16).slice(2, 42).padEnd(40, '0'),
        );
        return new UniswapV2Pair(randomAddr, t0, t1, r0, r1);
    };

    describe('test_direct_vs_multihop', () => {
        it('should choose multi-hop when liquidity is better than direct pool', () => {
            const poolDirect = createPool(
                SHIB,
                USDC,
                parseUnits('1000000000', 18),
                parseUnits('1000', 6),
            );
            const poolSHIB_WETH = createPool(
                SHIB,
                WETH,
                parseUnits('1000000000', 18),
                parseUnits('50', 18),
            );
            const poolWETH_USDC = createPool(
                WETH,
                USDC,
                parseUnits('50', 18),
                parseUnits('100000', 6),
            );

            const finder = new RouteFinder([poolDirect, poolSHIB_WETH, poolWETH_USDC]);
            const amountIn = parseUnits('1000000', 18);
            const gasPrice = 1n;

            const [bestRoute] = finder.findBestRoute(SHIB, USDC, amountIn, gasPrice);

            expect(bestRoute).toBeDefined();
            expect(bestRoute?.numHops).toBe(2);
            expect(bestRoute?.path[1].equals(WETH)).toBe(true);
        });
    });

    describe('test_gas_makes_direct_better', () => {
        it('should prefer direct route when gas prices are extremely high', () => {
            const poolDirect = createPool(
                SHIB,
                USDC,
                parseUnits('1000000', 18),
                parseUnits('1000', 6),
            );

            const poolStep1 = createPool(
                SHIB,
                WETH,
                parseUnits('1000000', 18),
                parseUnits('10', 18),
            );
            const poolStep2 = createPool(WETH, USDC, parseUnits('10', 18), parseUnits('1050', 6));

            const finder = new RouteFinder([poolDirect, poolStep1, poolStep2]);
            const amountIn = parseUnits('10000', 18);

            const [cheapRoute] = finder.findBestRoute(SHIB, USDC, amountIn, 1n);
            expect(cheapRoute?.numHops).toBe(2);

            const [expensiveRoute] = finder.findBestRoute(SHIB, USDC, amountIn, 500000n);
            expect(expensiveRoute?.numHops).toBe(1);
        });
    });

    describe('test_no_route_exists', () => {
        it('should handle disconnected tokens gracefully', () => {
            const pool1 = createPool(SHIB, WETH, parseUnits('1000', 18), parseUnits('1', 18));
            const pool2 = createPool(USDC, WETH, parseUnits('1000', 6), parseUnits('1', 18));

            const DAI = new Token(
                'DAI',
                18,
                new Address('0x6B175474E89094C44Da98b954EedeAC495271d0F'),
            );

            const finder = new RouteFinder([pool1, pool2]);
            const [route, netOutput] = finder.findBestRoute(SHIB, DAI, parseUnits('100', 18), 1n);

            expect(route).toBeNull();
            expect(netOutput).toBe(-1n);
        });
    });

    describe('test_route_output_matches_sequential_swaps', () => {
        it('should equal the result of manual step-by-step swaps', () => {
            const pool1 = createPool(SHIB, WETH, parseUnits('1000000', 18), parseUnits('10', 18));
            const pool2 = createPool(WETH, USDC, parseUnits('10', 18), parseUnits('20000', 6));

            const route = new Route([pool1, pool2], [SHIB, WETH, USDC]);
            const amountIn = parseUnits('1000', 18);

            const out1 = pool1.getAmountOut(amountIn, SHIB);
            const out2 = pool2.getAmountOut(out1, WETH);

            expect(route.getOutput(amountIn)).toBe(out2);

            const intermediate = route.getIntermediateAmounts(amountIn);
            expect(intermediate[0]).toBe(amountIn);
            expect(intermediate[1]).toBe(out1);
            expect(intermediate[2]).toBe(out2);
        });
    });
});
