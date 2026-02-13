import { PricingEngine, QuoteError } from '../../src/pricing/PricingEngine';
import { ChainClient } from '../../src/chain/ChainClient';
import { ForkSimulator } from '../../src/pricing/ForkSimulator';
import { MempoolMonitor, ParsedSwap } from '../../src/pricing/MempoolMonitor';
import { UniswapV2Pair } from '../../src/pricing/UniswapV2Pair';
import { RouteFinder } from '../../src/pricing/RouteFinder';
import { Token } from '../../src/pricing/Token';
import { Address } from '../../src/core/types/Address';
import { Route } from '../../src/pricing/Route';

jest.mock('../../src/chain/ChainClient');
jest.mock('../../src/pricing/ForkSimulator');
jest.mock('../../src/pricing/MempoolMonitor');
jest.mock('../../src/pricing/UniswapV2Pair');
jest.mock('../../src/pricing/RouteFinder');

describe('PricingEngine', () => {
    let engine: PricingEngine;
    let mockClient: jest.Mocked<ChainClient>;
    let mockSimulator: jest.Mocked<ForkSimulator>;
    let mockMonitor: jest.Mocked<MempoolMonitor>;

    let mempoolCallback: (swap: Partial<ParsedSwap>) => void;

    const FORK_URL = 'http://localhost:8545';
    const WS_URL = 'ws://localhost:8546';

    const TOKEN_A = new Token('TKA', 18, new Address('0x1111111111111111111111111111111111111111'));
    const TOKEN_B = new Token('TKB', 18, new Address('0x2222222222222222222222222222222222222222'));
    const PAIR_ADDR = new Address('0x3333333333333333333333333333333333333333');

    beforeEach(() => {
        jest.clearAllMocks();

        mockClient = new ChainClient(['http://dummy']) as jest.Mocked<ChainClient>;

        (MempoolMonitor as unknown as jest.Mock).mockImplementation(
            (url: string, cb: (swap: Partial<ParsedSwap>) => void) => {
                mempoolCallback = cb;
                return {
                    start: jest.fn().mockResolvedValue(undefined),
                };
            },
        );

        (ForkSimulator as unknown as jest.Mock).mockImplementation(() => ({
            ensureSenderReady: jest.fn().mockResolvedValue(undefined),
            simulateRoute: jest.fn(),
        }));

        engine = new PricingEngine(mockClient, FORK_URL, WS_URL);

        mockSimulator = engine['simulator'] as jest.Mocked<ForkSimulator>;
        mockMonitor = engine['monitor'] as jest.Mocked<MempoolMonitor>;
    });

    describe('start', () => {
        it('should start the mempool monitor', async () => {
            await engine.start();
            expect(mockMonitor.start).toHaveBeenCalled();
        });
    });

    describe('loadPools', () => {
        it('should load pools and initialize router', async () => {
            const mockPair = { address: PAIR_ADDR, checksum: PAIR_ADDR.checksum };
            (UniswapV2Pair.fromChain as jest.Mock).mockResolvedValue(mockPair);

            await engine.loadPools([PAIR_ADDR]);

            expect(UniswapV2Pair.fromChain).toHaveBeenCalledWith(PAIR_ADDR, mockClient);
            expect(RouteFinder).toHaveBeenCalledWith([mockPair]);

            const poolsMap = engine['pools'] as Map<string, UniswapV2Pair>;
            expect(poolsMap.get(PAIR_ADDR.checksum)).toBe(mockPair);
        });

        it('should throw error if pool loading fails', async () => {
            const error = new Error('Network error');
            (UniswapV2Pair.fromChain as jest.Mock).mockRejectedValue(error);

            await expect(engine.loadPools([PAIR_ADDR])).rejects.toThrow(error);
        });
    });

    describe('refreshPool', () => {
        it('should reload specific pool and update router', async () => {
            const oldPair = { address: PAIR_ADDR, checksum: PAIR_ADDR.checksum, id: 1 };
            const newPair = { address: PAIR_ADDR, checksum: PAIR_ADDR.checksum, id: 2 };

            (UniswapV2Pair.fromChain as jest.Mock).mockResolvedValue(oldPair);
            await engine.loadPools([PAIR_ADDR]);

            (UniswapV2Pair.fromChain as jest.Mock).mockResolvedValue(newPair);
            await engine.refreshPool(PAIR_ADDR);

            const poolsMap = engine['pools'] as Map<string, UniswapV2Pair>;

            expect(UniswapV2Pair.fromChain).toHaveBeenCalledTimes(2);
            expect(poolsMap.get(PAIR_ADDR.checksum)).toBe(newPair);
            expect(RouteFinder).toHaveBeenCalledTimes(2);
        });

        it('should handle refresh errors gracefully without crashing', async () => {
            await engine.loadPools([PAIR_ADDR]);

            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            (UniswapV2Pair.fromChain as jest.Mock).mockRejectedValue(new Error('Refresh failed'));

            await engine.refreshPool(PAIR_ADDR);

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('getQuote', () => {
        const amountIn = 1000n;
        const gasPrice = 50n;
        let mockRoute: Route;

        beforeEach(async () => {
            const mockPair = { address: PAIR_ADDR };
            (UniswapV2Pair.fromChain as jest.Mock).mockResolvedValue(mockPair);
            await engine.loadPools([PAIR_ADDR]);

            mockRoute = {} as Route;
        });

        it('should throw error if router is not initialized', async () => {
            const emptyEngine = new PricingEngine(mockClient, FORK_URL, WS_URL);
            await expect(
                emptyEngine.getQuote(TOKEN_A, TOKEN_B, amountIn, gasPrice),
            ).rejects.toThrow('Router not initialized');
        });

        it('should throw QuoteError if no route found', async () => {
            const mockRouterInstance = (RouteFinder as jest.Mock).mock.instances[0];
            mockRouterInstance.findBestRoute.mockReturnValue([null, 0n]);

            await expect(engine.getQuote(TOKEN_A, TOKEN_B, amountIn, gasPrice)).rejects.toThrow(
                QuoteError,
            );
            await expect(engine.getQuote(TOKEN_A, TOKEN_B, amountIn, gasPrice)).rejects.toThrow(
                'No valid route found',
            );
        });

        it('should throw QuoteError if simulation fails', async () => {
            const mockRouterInstance = (RouteFinder as jest.Mock).mock.instances[0];
            mockRouterInstance.findBestRoute.mockReturnValue([mockRoute, 900n]);

            mockSimulator.simulateRoute.mockResolvedValue({
                success: false,
                amountOut: 0n,
                gasUsed: 0n,
                error: 'Revert',
                logs: [],
            });

            await expect(engine.getQuote(TOKEN_A, TOKEN_B, amountIn, gasPrice)).rejects.toThrow(
                QuoteError,
            );
            await expect(engine.getQuote(TOKEN_A, TOKEN_B, amountIn, gasPrice)).rejects.toThrow(
                'Simulation failed: Revert',
            );
        });

        it('should return valid Quote on success', async () => {
            const expectedOutput = 1_000_000n;
            const simulatedOutput = 999_500n;
            const gasUsed = 100000n;

            const mockRouterInstance = (RouteFinder as jest.Mock).mock.instances[0];
            mockRouterInstance.findBestRoute.mockReturnValue([mockRoute, expectedOutput]);

            mockSimulator.simulateRoute.mockResolvedValue({
                success: true,
                amountOut: simulatedOutput,
                gasUsed: gasUsed,
                logs: [],
            });

            const quote = await engine.getQuote(TOKEN_A, TOKEN_B, amountIn, gasPrice);

            expect(quote.amountIn).toBe(amountIn);
            expect(quote.expectedOutput).toBe(expectedOutput);
            expect(quote.simulatedOutput).toBe(simulatedOutput);
            expect(quote.gasEstimate).toBe(gasUsed);
            expect(quote.route).toBe(mockRoute);
            expect(quote.isValid).toBe(true);
        });

        it('should mark quote as invalid if discrepancy is too high', async () => {
            const mockRouterInstance = (RouteFinder as jest.Mock).mock.instances[0];
            mockRouterInstance.findBestRoute.mockReturnValue([mockRoute, 1000n]);

            mockSimulator.simulateRoute.mockResolvedValue({
                success: true,
                amountOut: 500n,
                gasUsed: 100000n,
                logs: [],
            });

            const quote = await engine.getQuote(TOKEN_A, TOKEN_B, amountIn, gasPrice);
            expect(quote.isValid).toBe(false);
        });
    });

    describe('Mempool Integration', () => {
        it('should ignore swaps missing token data', () => {
            const spy = jest.spyOn(engine, 'refreshPool');
            mempoolCallback({});
            expect(spy).not.toHaveBeenCalled();
        });

        it('should trigger refreshPool when swap involves tracked pool tokens', async () => {
            const mockPair = {
                address: PAIR_ADDR,
                checksum: PAIR_ADDR.checksum,
                token0: {
                    address: { equals: (o: string | Address) => o === TOKEN_A.address.checksum },
                },
                token1: {
                    address: { equals: (o: string | Address) => o === TOKEN_B.address.checksum },
                },
            };
            (UniswapV2Pair.fromChain as jest.Mock).mockResolvedValue(mockPair);
            await engine.loadPools([PAIR_ADDR]);

            const spy = jest.spyOn(engine, 'refreshPool');

            mempoolCallback({
                tokenIn: TOKEN_A.address.checksum,
                tokenOut: TOKEN_B.address.checksum,
            });

            expect(spy).toHaveBeenCalledWith(PAIR_ADDR);
        });

        it('should not trigger refresh if swap involves unrelated tokens', async () => {
            const mockPair = {
                address: PAIR_ADDR,
                checksum: PAIR_ADDR.checksum,
                token0: { address: { equals: () => false } },
                token1: { address: { equals: () => false } },
            };
            (UniswapV2Pair.fromChain as jest.Mock).mockResolvedValue(mockPair);
            await engine.loadPools([PAIR_ADDR]);

            const spy = jest.spyOn(engine, 'refreshPool');

            mempoolCallback({
                tokenIn: '0xOTHER',
                tokenOut: '0xANOTHER',
            });

            expect(spy).not.toHaveBeenCalled();
        });
    });
});
