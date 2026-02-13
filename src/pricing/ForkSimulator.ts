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
    private static ROUTER_ADDRESS = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
    private static WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    private static ERC20_ABI = [
        'function balanceOf(address owner) view returns (uint256)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'function approve(address spender, uint256 amount) returns (bool)',
        'function transfer(address to, uint256 amount) returns (bool)',
    ];
    private static WETH_ABI = ['function deposit() payable'];
    private static TOKEN_WHALES: Record<string, string> = {
        '0xdAC17F958D2ee523a2206206994597C13D831ec7': '0x28C6c06298d514Db089934071355E5743bf21d60', // USDT
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': '0x28C6c06298d514Db089934071355E5743bf21d60', // USDC
    };
    private static ROUTER_ABI = [
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
        'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
        'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
        'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
    ];

    constructor(forkUrl: string) {
        this.provider = new ethers.JsonRpcProvider(forkUrl);
    }

    public async ensureSenderReady(route: Route, amountIn: bigint, sender: Address): Promise<void> {
        const tokenIn = route.path[0];
        const tokenInAddress = tokenIn.address.checksum;
        const senderAddress = sender.checksum;

        const signer = await this.provider.getSigner(senderAddress);
        const token = new ethers.Contract(tokenInAddress, ForkSimulator.ERC20_ABI, signer);

        let balance: bigint = await token.balanceOf(senderAddress);
        if (balance < amountIn) {
            const deficit = amountIn - balance;
            if (tokenInAddress.toLowerCase() === ForkSimulator.WETH_ADDRESS.toLowerCase()) {
                const weth = new ethers.Contract(tokenInAddress, ForkSimulator.WETH_ABI, signer);
                const wrapAmount = deficit + deficit / 10n + 1n;
                const tx = await weth.deposit({ value: wrapAmount });
                await tx.wait();
            } else {
                await this.fundFromWhale(
                    tokenInAddress,
                    senderAddress,
                    deficit + deficit / 10n + 1n,
                );
            }

            balance = await token.balanceOf(senderAddress);
            if (balance < amountIn) {
                throw new Error(
                    `Insufficient ${tokenIn.name} balance for ${senderAddress}: have ${balance}, need ${amountIn}`,
                );
            }
        }

        const allowance: bigint = await token.allowance(
            senderAddress,
            ForkSimulator.ROUTER_ADDRESS,
        );
        if (allowance < amountIn) {
            const approveTx = await token.approve(ForkSimulator.ROUTER_ADDRESS, ethers.MaxUint256);
            await approveTx.wait();
        }
    }

    private async fundFromWhale(tokenAddress: string, to: string, amount: bigint): Promise<void> {
        const whale = ForkSimulator.TOKEN_WHALES[tokenAddress];
        if (!whale) {
            throw new Error(
                `No whale configured for token ${tokenAddress}. Add funding source or pre-fund sender.`,
            );
        }

        try {
            await this.provider.send('anvil_setBalance', [
                whale,
                ethers.toQuantity(ethers.parseEther('10')),
            ]);
            await this.provider.send('anvil_impersonateAccount', [whale]);

            const whaleSigner = await this.provider.getSigner(whale);
            const token = new ethers.Contract(tokenAddress, ForkSimulator.ERC20_ABI, whaleSigner);
            const tx = await token.transfer(to, amount);
            await tx.wait();
        } finally {
            await this.provider
                .send('anvil_stopImpersonatingAccount', [whale])
                .catch(() => undefined);
        }
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

        const routerAddress = new Address(ForkSimulator.ROUTER_ADDRESS);

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
