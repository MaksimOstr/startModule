import { ethers, Interface } from 'ethers';
import { Address } from '../core/types/Address';
import { Token } from './Token';
import { Route } from './Route';
import { UniswapV2Pair } from './UniswapV2Pair';
import { Config } from '../config';

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
    private static ROUTER_ADDRESS = Config.ROUTER;
    private static WETH_ADDRESS = Config.WETH_ADDRESS;
    private static TOKEN_FUNDERS = ForkSimulator.parseTokenFundersFromEnv();
    private static ERC20_ABI = [
        {
            type: 'function',
            name: 'balanceOf',
            stateMutability: 'view',
            inputs: [{ name: 'owner', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }],
        },
        {
            type: 'function',
            name: 'allowance',
            stateMutability: 'view',
            inputs: [
                { name: 'owner', type: 'address' },
                { name: 'spender', type: 'address' },
            ],
            outputs: [{ name: '', type: 'uint256' }],
        },
        {
            type: 'function',
            name: 'approve',
            stateMutability: 'nonpayable',
            inputs: [
                { name: 'spender', type: 'address' },
                { name: 'amount', type: 'uint256' },
            ],
            outputs: [{ name: '', type: 'bool' }],
        },
        {
            type: 'function',
            name: 'transfer',
            stateMutability: 'nonpayable',
            inputs: [
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' },
            ],
            outputs: [{ name: '', type: 'bool' }],
        },
    ];
    private static WETH_ABI = [
        {
            type: 'function',
            name: 'deposit',
            stateMutability: 'payable',
            inputs: [],
            outputs: [],
        },
    ];
    private static ROUTER_ABI = [
        {
            type: 'function',
            name: 'swapExactTokensForTokens',
            stateMutability: 'nonpayable',
            inputs: [
                { name: 'amountIn', type: 'uint256' },
                { name: 'amountOutMin', type: 'uint256' },
                { name: 'path', type: 'address[]' },
                { name: 'to', type: 'address' },
                { name: 'deadline', type: 'uint256' },
            ],
            outputs: [{ name: 'amounts', type: 'uint256[]' }],
        },
        {
            type: 'function',
            name: 'swapExactETHForTokens',
            stateMutability: 'payable',
            inputs: [
                { name: 'amountOutMin', type: 'uint256' },
                { name: 'path', type: 'address[]' },
                { name: 'to', type: 'address' },
                { name: 'deadline', type: 'uint256' },
            ],
            outputs: [{ name: 'amounts', type: 'uint256[]' }],
        },
        {
            type: 'function',
            name: 'swapExactTokensForETH',
            stateMutability: 'nonpayable',
            inputs: [
                { name: 'amountIn', type: 'uint256' },
                { name: 'amountOutMin', type: 'uint256' },
                { name: 'path', type: 'address[]' },
                { name: 'to', type: 'address' },
                { name: 'deadline', type: 'uint256' },
            ],
            outputs: [{ name: 'amounts', type: 'uint256[]' }],
        },
        {
            type: 'function',
            name: 'getAmountsOut',
            stateMutability: 'view',
            inputs: [
                { name: 'amountIn', type: 'uint256' },
                { name: 'path', type: 'address[]' },
            ],
            outputs: [{ name: 'amounts', type: 'uint256[]' }],
        },
    ];

    private static parseTokenFundersFromEnv(): Record<string, string> {
        const raw = process.env.FORK_TOKEN_FUNDERS;
        if (!raw) return {};

        try {
            const parsed = JSON.parse(raw) as Record<string, string>;
            const normalized: Record<string, string> = {};
            for (const [tokenAddress, funderAddress] of Object.entries(parsed)) {
                if (!ethers.isAddress(tokenAddress) || !ethers.isAddress(funderAddress)) {
                    continue;
                }
                normalized[tokenAddress.toLowerCase()] = ethers.getAddress(funderAddress);
            }
            return normalized;
        } catch {
            console.warn(
                '[ForkSimulator] Invalid FORK_TOKEN_FUNDERS JSON. Expected {"tokenAddress":"funderAddress"}',
            );
            return {};
        }
    }

    constructor(forkUrl: string) {
        this.provider = new ethers.JsonRpcProvider(forkUrl);
    }

    private async withImpersonatedAccount(address: string, fn: () => Promise<void>): Promise<void> {
        let impersonated = false;
        try {
            await this.provider
                .send('anvil_setBalance', [address, ethers.toQuantity(ethers.parseEther('10'))])
                .catch(() => undefined);
            await this.provider.send('anvil_impersonateAccount', [address]);
            impersonated = true;
        } catch {
            impersonated = false;
        }

        try {
            await fn();
        } finally {
            if (impersonated) {
                await this.provider
                    .send('anvil_stopImpersonatingAccount', [address])
                    .catch(() => undefined);
            }
        }
    }

    private async fundFromConfiguredFounder(
        tokenAddress: string,
        receiverAddress: string,
        amount: bigint,
    ): Promise<void> {
        const funderAddress = ForkSimulator.TOKEN_FUNDERS[tokenAddress.toLowerCase()];
        if (!funderAddress) {
            throw new Error(
                `Insufficient token balance and no funder for ${tokenAddress}. Set FORK_TOKEN_FUNDERS in .env`,
            );
        }

        await this.withImpersonatedAccount(funderAddress, async () => {
            const signer = await this.provider.getSigner(funderAddress);
            const token = new ethers.Contract(tokenAddress, ForkSimulator.ERC20_ABI, signer);
            const funderBalance: bigint = await token.balanceOf(funderAddress);
            if (funderBalance < amount) {
                throw new Error(
                    `Funder ${funderAddress} has insufficient token balance: have ${funderBalance}, need ${amount}`,
                );
            }

            const tx = await token.transfer(receiverAddress, amount);
            await tx.wait();
        });
    }

    public async ensureSenderReady(route: Route, amountIn: bigint, sender: Address): Promise<void> {
        const tokenIn = route.path[0];
        const tokenInAddress = tokenIn.address.checksum;
        const senderAddress = sender.checksum;
        await this.withImpersonatedAccount(senderAddress, async () => {
            const signer = await this.provider.getSigner(senderAddress);
            const token = new ethers.Contract(tokenInAddress, ForkSimulator.ERC20_ABI, signer);

            let balance: bigint = await token.balanceOf(senderAddress);
            if (balance < amountIn) {
                const deficit = amountIn - balance;
                if (tokenInAddress.toLowerCase() === ForkSimulator.WETH_ADDRESS.toLowerCase()) {
                    const weth = new ethers.Contract(
                        tokenInAddress,
                        ForkSimulator.WETH_ABI,
                        signer,
                    );
                    const wrapAmount = deficit + deficit / 10n + 1n;
                    const tx = await weth.deposit({ value: wrapAmount });
                    await tx.wait();
                } else {
                    const topUpAmount = deficit + deficit / 10n + 1n;
                    await this.fundFromConfiguredFounder(
                        tokenInAddress,
                        senderAddress,
                        topUpAmount,
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
                const approveTx = await token.approve(
                    ForkSimulator.ROUTER_ADDRESS,
                    ethers.MaxUint256,
                );
                await approveTx.wait();
            }
        });
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
        await this.ensureSenderReady(route, amountIn, sender);

        const pathAddresses = route.path.map((t) => t.address.checksum);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
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
