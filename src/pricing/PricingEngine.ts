import { ChainClient } from '../chain/ChainClient';
import { UniswapV2Pair } from './UniswapV2Pair';
import { RouteFinder } from './RouteFinder';
import { Address } from '../core/types/Address';
import { Token } from './Token';
import { Route } from './Route';
import { ForkSimulator } from './ForkSimulator';
import { MempoolMonitor, ParsedSwap } from './MempoolMonitor';
import { Priority } from '../chain/types/GasPrice';

export class QuoteError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'QuoteError';
    }
}

export class Quote {
    constructor(
        public route: Route,
        public amountIn: bigint,
        public expectedOutput: bigint,
        public simulatedOutput: bigint,
        public gasEstimate: bigint,
        public timestamp: number,
    ) {}

    get isValid(): boolean {
        if (this.expectedOutput === 0n) return false;

        const diff =
            this.expectedOutput > this.simulatedOutput
                ? this.expectedOutput - this.simulatedOutput
                : this.simulatedOutput - this.expectedOutput;

        return diff * 1000n < this.expectedOutput;
    }
}

export class PricingEngine {
    private client: ChainClient;
    private simulator: ForkSimulator;
    private monitor: MempoolMonitor;

    private pools: Map<string, UniswapV2Pair>;
    private router: RouteFinder | null;

    constructor(chainClient: ChainClient, forkUrl: string, wsUrl: string) {
        this.client = chainClient;
        this.simulator = new ForkSimulator(forkUrl);
        this.monitor = new MempoolMonitor(wsUrl, this.onMempoolSwap.bind(this));
        this.pools = new Map();
        this.router = null;
    }

    public async start(): Promise<void> {
        await this.monitor.start();
    }

    public async fetchGasPriceGwei(): Promise<bigint> {
        const gas = await this.client.getGasPrice();
        return gas.getMaxFee(Priority.MEDIUM) / 1_000_000_000n;
    }

    public async loadPools(poolAddresses: Address[]): Promise<void> {
        const promises = poolAddresses.map((addr) => UniswapV2Pair.fromChain(addr, this.client));

        try {
            const loadedPairs = await Promise.all(promises);

            for (const pair of loadedPairs) {
                this.pools.set(pair.address.checksum, pair);
            }

            this.router = new RouteFinder(Array.from(this.pools.values()));
        } catch (error) {
            console.error('Failed to load pools:', error);
            throw error;
        }
    }

    public async refreshPool(address: Address): Promise<void> {
        try {
            const newPair = await UniswapV2Pair.fromChain(address, this.client);
            this.pools.set(address.checksum, newPair);

            if (this.router) {
                this.router = new RouteFinder(Array.from(this.pools.values()));
            }
        } catch (error) {
            console.error(`Failed to refresh pool ${address.checksum}`, error);
        }
    }

    public async getQuote(
        tokenIn: Token,
        tokenOut: Token,
        amountIn: bigint,
        gasPriceGwei: bigint,
    ): Promise<Quote> {
        if (!this.router) {
            throw new Error('Router not initialized. Call loadPools first.');
        }

        const [route, netOutput] = this.router.findBestRoute(
            tokenIn,
            tokenOut,
            amountIn,
            gasPriceGwei,
        );

        if (!route) {
            throw new QuoteError('No valid route found');
        }

        const IMPERSONATED_SENDER = new Address('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');

        const simResult = await this.simulator.simulateRoute(route, amountIn, IMPERSONATED_SENDER);

        if (!simResult.success) {
            throw new QuoteError(`Simulation failed: ${simResult.error}`);
        }

        return new Quote(
            route,
            amountIn,
            netOutput,
            simResult.amountOut,
            simResult.gasUsed,
            Date.now() / 1000,
        );
    }

    private onMempoolSwap(swap: ParsedSwap): void {
        if (!swap.tokenIn || !swap.tokenOut) return;

        for (const pair of this.pools.values()) {
            const involvesToken0 =
                pair.token0.address.equals(swap.tokenIn) ||
                pair.token0.address.equals(swap.tokenOut);
            const involvesToken1 =
                pair.token1.address.equals(swap.tokenIn) ||
                pair.token1.address.equals(swap.tokenOut);

            if (involvesToken0 && involvesToken1) {
                console.log(
                    `[PricingEngine] Mempool swap detected for tracked pool: ${pair.address.checksum}`,
                );
                this.refreshPool(pair.address).catch(console.error);
                break;
            }
        }
    }
}
