import { ethers, Interface } from 'ethers';
import { Address } from '../core/types/Address';
import { Token } from './Token';
import { Route } from './Route';
import { UniswapV2Pair } from './UniswapV2Pair';

export interface SimulationResult {
    success: boolean;
    amountOut: bigint;
    gasUsed: bigint;
    error?: string;
    logs: string[];
}

export interface SwapParams {
    method: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any[];
    value?: bigint;
}

export class ForkSimulator {
    private provider: ethers.JsonRpcProvider;
    private static ROUTER_ABI = [
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
        'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
        'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
        'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
    ];

    constructor(forkUrl: string) {
        this.provider = new ethers.JsonRpcProvider(forkUrl);
    }

    public async simulateSwap(
        router: Address,
        swapParams: SwapParams,
        sender: Address,
    ): Promise<SimulationResult> {
        try {
            const iface = new Interface(ForkSimulator.ROUTER_ABI);
            const data = iface.encodeFunctionData(swapParams.method, swapParams.args);
            const value = swapParams.value || 0n;

            const txRequest = {
                to: router.checksum,
                from: sender.checksum,
                data: data,
                value: value,
            };

            const gasUsed = await this.provider.estimateGas(txRequest);
            const rawResult = await this.provider.call(txRequest);
            const decoded = iface.decodeFunctionResult(swapParams.method, rawResult);

            const amounts = decoded[0] as bigint[];
            const amountOut = amounts[amounts.length - 1];

            return {
                success: true,
                amountOut: amountOut,
                gasUsed: gasUsed,
                logs: [],
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            return {
                success: false,
                amountOut: 0n,
                gasUsed: 0n,
                error: error.message || 'Unknown simulation error',
                logs: [],
            };
        }
    }

    public async simulateRoute(
        route: Route,
        amountIn: bigint,
        sender: Address,
    ): Promise<SimulationResult> {
        const pathAddresses = route.path.map((t) => t.address.checksum);
        const deadline = Math.floor(Date.now() / 1000) + 1800;

        const params: SwapParams = {
            method: 'swapExactTokensForTokens',
            args: [amountIn, 0n, pathAddresses, sender.checksum, deadline],
        };

        const routerAddress = new Address('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D');

        return this.simulateSwap(routerAddress, params, sender);
    }

    public async compareSimulationVsCalculation(
        pair: UniswapV2Pair,
        amountIn: bigint,
        tokenIn: Token,
    ): Promise<{
        calculated: bigint;
        simulated: bigint;
        difference: bigint;
        match: boolean;
    }> {
        const calculated = pair.getAmountOut(amountIn, tokenIn);

        const impersonatedSender = new Address('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
        const tokenOut = tokenIn.address.equals(pair.token0.address) ? pair.token1 : pair.token0;

        const route = new Route([pair], [tokenIn, tokenOut]);

        const simulationResult = await this.simulateRoute(route, amountIn, impersonatedSender);

        const simulated = simulationResult.success ? simulationResult.amountOut : 0n;
        const diff = calculated > simulated ? calculated - simulated : simulated - calculated;

        return {
            calculated: calculated,
            simulated: simulated,
            difference: diff,
            match: diff === 0n,
        };
    }
}
