import { Token } from './Token';
import { UniswapV2Pair } from './UniswapV2Pair';

export class Route {
    pools: UniswapV2Pair[];
    path: Token[];

    constructor(pools: UniswapV2Pair[], path: Token[]) {
        this.pools = pools;
        this.path = path;
    }

    get numHops(): number {
        return this.pools.length;
    }

    getOutput(amountIn: bigint): bigint {
        let amount = amountIn;

        for (let i = 0; i < this.pools.length; i++) {
            amount = this.pools[i].getAmountOut(amount, this.path[i]);
        }

        return amount;
    }

    getIntermediateAmounts(amountIn: bigint): bigint[] {
        const amounts: bigint[] = [amountIn];
        let amount = amountIn;

        for (let i = 0; i < this.pools.length; i++) {
            amount = this.pools[i].getAmountOut(amount, this.path[i]);
            amounts.push(amount);
        }

        return amounts;
    }

    estimateGas(): bigint {
        return 150_000n + BigInt(this.numHops) * 100_000n;
    }

    toString(): string {
        return this.path.map((t) => t.name).join(' -> ');
    }
}
