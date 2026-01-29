import { Token } from './Token';
import { Route } from './Route';
import { Address } from '../core/types/Address';
import { UniswapV2Pair } from './UniswapV2Pair';

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
        const allRoutes = this.findAllRoutes(tokenIn, tokenOut, maxHops);

        let bestRoute: Route | null = null;
        let maxNetOutput = -1n;

        for (const route of allRoutes) {
            try {
                const grossOutput = route.getOutput(amountIn);
                const gasCostInOutput = this.calculateGasCostInOutputToken(
                    route,
                    tokenIn,
                    tokenOut,
                    gasPriceGwei,
                );

                const netOutput =
                    grossOutput > gasCostInOutput ? grossOutput - gasCostInOutput : 0n;

                if (netOutput > maxNetOutput) {
                    maxNetOutput = netOutput;
                    bestRoute = route;
                }
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (error) {
                continue;
            }
        }

        return [bestRoute, maxNetOutput];
    }

    public compareRoutes(
        tokenIn: Token,
        tokenOut: Token,
        amountIn: bigint,
        gasPriceGwei: bigint,
    ): RouteComparison[] {
        const allRoutes = this.findAllRoutes(tokenIn, tokenOut);
        const results: RouteComparison[] = [];

        for (const route of allRoutes) {
            try {
                const grossOutput = route.getOutput(amountIn);
                const gasEstimate = route.estimateGas();

                const gasCostInOutput = this.calculateGasCostInOutputToken(
                    route,
                    tokenIn,
                    tokenOut,
                    gasPriceGwei,
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

    private calculateGasCostInOutputToken(
        route: Route,
        tokenIn: Token,
        tokenOut: Token,
        gasPriceGwei: bigint,
    ): bigint {
        const gasEstimate = route.estimateGas();
        const gasCostWei = gasEstimate * gasPriceGwei * 1_000_000_000n;

        if (this.isEth(tokenOut)) {
            return gasCostWei;
        }
        if (this.isEth(tokenIn)) {
            try {
                return route.getOutput(gasCostWei);
            } catch {
                return 0n;
            }
        }
        try {
            const wethToken = new Token(
                'WETH',
                18,
                new Address('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
            );

            const [ethRoute] = this.findBestRoute(wethToken, tokenOut, gasCostWei, gasPriceGwei, 2);

            if (ethRoute) {
                return ethRoute.getOutput(gasCostWei);
            }
        } catch {
            return 0n;
        }

        return 0n;
    }

    private isEth(token: Token): boolean {
        const name = token.name.toUpperCase();
        return name === 'ETH' || name === 'WETH';
    }
}
