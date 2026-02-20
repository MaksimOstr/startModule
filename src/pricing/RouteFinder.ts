import { Token } from './Token';
import { Route } from './Route';
import { UniswapV2Pair } from './UniswapV2Pair';
import { Config } from '../config';

export interface RouteComparison {
    route: Route;
    grossOutput: bigint;
    gasEstimate: bigint;
    gasCost: bigint;
    netOutput: bigint;
}

export class RouteFinder {
    public pools: UniswapV2Pair[];
    private graph: Map<string, Array<{ pool: UniswapV2Pair; otherToken: Token }>>;

    constructor(pools: UniswapV2Pair[]) {
        this.pools = pools;
        this.graph = this.buildGraph();
    }

    private buildGraph(): Map<string, Array<{ pool: UniswapV2Pair; otherToken: Token }>> {
        const graph = new Map<string, Array<{ pool: UniswapV2Pair; otherToken: Token }>>();

        for (const pool of this.pools) {
            this.addEdge(graph, pool.token0, pool.token1, pool);
            this.addEdge(graph, pool.token1, pool.token0, pool);
        }

        return graph;
    }

    private addEdge(
        graph: Map<string, Array<{ pool: UniswapV2Pair; otherToken: Token }>>,
        tokenA: Token,
        tokenB: Token,
        pool: UniswapV2Pair,
    ) {
        const key = tokenA.address.checksum;
        if (!graph.has(key)) {
            graph.set(key, []);
        }
        graph.get(key)!.push({ pool, otherToken: tokenB });
    }

    public findAllRoutes(tokenIn: Token, tokenOut: Token, maxHops: number = 3): Route[] {
        const routes: Route[] = [];

        const dfs = (currentToken: Token, currentPath: Token[], currentPools: UniswapV2Pair[]) => {
            if (currentPath.length > maxHops + 1) return;

            if (
                currentToken.address.checksum === tokenOut.address.checksum &&
                currentPath.length > 1
            ) {
                routes.push(new Route([...currentPools], [...currentPath]));
                return;
            }

            const neighbors = this.graph.get(currentToken.address.checksum) || [];

            for (const { pool, otherToken } of neighbors) {
                if (currentPath.some((t) => t.address.checksum === otherToken.address.checksum)) {
                    continue;
                }

                currentPath.push(otherToken);
                currentPools.push(pool);

                dfs(otherToken, currentPath, currentPools);

                currentPools.pop();
                currentPath.pop();
            }
        };

        dfs(tokenIn, [tokenIn], []);
        return routes;
    }

    public findBestRoute(
        tokenIn: Token,
        tokenOut: Token,
        amountIn: bigint,
        gasPriceGwei: bigint,
        maxHops: number = 3,
    ): [Route | null, bigint] {
        if (amountIn <= 0n) {
            return [null, 0n];
        }

        const comparisons = this.compareRoutes(tokenIn, tokenOut, amountIn, gasPriceGwei, maxHops);
        if (comparisons.length === 0) {
            return [null, 0n];
        }

        return [comparisons[0].route, comparisons[0].netOutput];
    }

    public compareRoutes(
        tokenIn: Token,
        tokenOut: Token,
        amountIn: bigint,
        gasPriceGwei: bigint,
        maxHops: number = 3,
    ): RouteComparison[] {
        const allRoutes = this.findAllRoutes(tokenIn, tokenOut, maxHops);
        const results: RouteComparison[] = [];
        const ethPriceInOut = this.getTokenEthPrice(tokenOut);

        for (const route of allRoutes) {
            try {
                const grossOutput = route.getOutput(amountIn);
                const gasEstimate = route.estimateGas();
                const gasCostWei = gasEstimate * gasPriceGwei * 1_000_000_000n;
                const gasCostInOutput = this.convertGasCostToOutputToken(
                    gasCostWei,
                    tokenOut,
                    ethPriceInOut,
                );

                const netOutput =
                    grossOutput > gasCostInOutput ? grossOutput - gasCostInOutput : 0n;

                results.push({
                    route,
                    grossOutput,
                    gasEstimate,
                    gasCost: gasCostInOutput,
                    netOutput,
                });
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (error) {
                continue;
            }
        }

        return results.sort((a, b) => {
            if (a.netOutput > b.netOutput) return -1;
            if (a.netOutput < b.netOutput) return 1;
            return 0;
        });
    }

    private convertGasCostToOutputToken(
        gasCostWei: bigint,
        tokenOut: Token,
        ethPriceInOut: bigint,
    ): bigint {
        if (gasCostWei <= 0n || ethPriceInOut <= 0n) return 0n;
        if (this.isWeth(tokenOut)) return gasCostWei;

        const wad = 10n ** 18n;
        const gasCostOutQ18 = this.mulDivCeil(gasCostWei, ethPriceInOut, wad);

        if (tokenOut.decimals === 18) return gasCostOutQ18;
        if (tokenOut.decimals > 18) {
            return gasCostOutQ18 * 10n ** BigInt(tokenOut.decimals - 18);
        }
        return this.divCeil(gasCostOutQ18, 10n ** BigInt(18 - tokenOut.decimals));
    }

    private mulDivCeil(a: bigint, b: bigint, denominator: bigint): bigint {
        return this.divCeil(a * b, denominator);
    }

    private divCeil(value: bigint, denominator: bigint): bigint {
        return (value + denominator - 1n) / denominator;
    }

    private getTokenEthPrice(tokenOut: Token): bigint {
        if (this.isWeth(tokenOut)) {
            return 10n ** 18n;
        }

        const neighbors = this.graph.get(tokenOut.address.checksum) || [];
        let bestPrice = 0n;
        let maxWethReserve = 0n;

        for (const { pool, otherToken } of neighbors) {
            if (!this.isWeth(otherToken)) continue;

            try {
                const wethReserve = pool.getReserve(otherToken.address);
                const tokenReserve = pool.getReserve(tokenOut.address);
                if (wethReserve <= 0n || tokenReserve <= 0n) {
                    continue;
                }

                const spotPrice = pool.getSpotPrice(otherToken);
                if (spotPrice <= 0n) {
                    continue;
                }

                if (wethReserve > maxWethReserve) {
                    maxWethReserve = wethReserve;
                    bestPrice = spotPrice;
                }
            } catch {
                continue;
            }
        }

        return bestPrice;
    }

    private isWeth(token: Token): boolean {
        return token.address.checksum.toLowerCase() === Config.WETH_ADDRESS.toLowerCase();
    }
}
