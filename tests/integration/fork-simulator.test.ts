import { ethers, Contract } from 'ethers';
import { ForkSimulator } from '../../src/pricing/ForkSimulator';
import { Address } from '../../src/core/types/Address';
import { Token } from '../../src/pricing/Token';
import { Route } from '../../src/pricing/Route';
import { UniswapV2Pair } from '../../src/pricing/UniswapV2Pair';

const WETH_ADDR = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC_ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const POOL_ADDR = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc';
const ROUTER_ADDR = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const WHALE_ADDR = '0x28C6c06298d514Db089934071355E5743bf21d60';

const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
];

const PAIR_ABI = [
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
];

describe('ForkSimulator Integration Tests', () => {
    const FORK_URL = 'http://127.0.0.1:8545';

    let simulator: ForkSimulator;
    let provider: ethers.JsonRpcProvider;

    const impersonateAccount = async (address: string) => {
        await provider.send('anvil_impersonateAccount', [address]);
    };

    const stopImpersonatingAccount = async (address: string) => {
        await provider.send('anvil_stopImpersonatingAccount', [address]);
    };

    const setBalance = async (address: string, amountEth: string) => {
        const hexBalance = ethers.toQuantity(ethers.parseEther(amountEth));
        await provider.send('anvil_setBalance', [address, hexBalance]);
    };

    beforeAll(async () => {
        provider = new ethers.JsonRpcProvider(FORK_URL);
        try {
            await provider.getBlockNumber();
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
            console.warn('⚠️  Skipping tests: Anvil fork is not running');
        }
        simulator = new ForkSimulator(FORK_URL);
    });

    test('should connect to fork and be on recent block', async () => {
        const blockNumber = await provider.getBlockNumber();
        expect(blockNumber).toBeGreaterThan(15_000_000);
    });

    test('should impersonate account and send transaction', async () => {
        const userAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
        const randomAddr = '0x1234567890123456789012345678901234567890';

        await setBalance(userAddress, '100');
        await impersonateAccount(userAddress);
        const signer = await provider.getSigner(userAddress);

        const tx = await signer.sendTransaction({
            to: randomAddr,
            value: ethers.parseEther('1'),
        });

        const receipt = await tx.wait();
        expect(receipt).not.toBeNull();
        expect(receipt!.status).toBe(1);

        await stopImpersonatingAccount(userAddress);
    });

    test('should simulate route execution (Whale Swap)', async () => {
        const weth = new Token('WETH', 18, new Address(WETH_ADDR));
        const usdc = new Token('USDC', 6, new Address(USDC_ADDR));

        const wethContract = new Contract(WETH_ADDR, ERC20_ABI, provider);
        const whaleBalance = await wethContract.balanceOf(WHALE_ADDR);

        if (whaleBalance < ethers.parseEther('1')) {
            console.warn('Whale has no WETH, skipping test');
            return;
        }

        await impersonateAccount(WHALE_ADDR);
        await setBalance(WHALE_ADDR, '10');
        const whaleSigner = await provider.getSigner(WHALE_ADDR);

        const wethWhale = wethContract.connect(whaleSigner) as Contract;
        await wethWhale.approve(ROUTER_ADDR, ethers.MaxUint256);

        const pair = new UniswapV2Pair(new Address(POOL_ADDR), weth, usdc, 0n, 0n);
        const route = new Route([pair], [weth, usdc]);
        const amountIn = ethers.parseEther('1');

        const result = await simulator.simulateRoute(route, amountIn, new Address(WHALE_ADDR));

        await stopImpersonatingAccount(WHALE_ADDR);

        expect(result.success).toBe(true);
        expect(result.amountOut).toBeGreaterThan(0n);

        const amountOutNumber = Number(ethers.formatUnits(result.amountOut, 6));
        console.log(`Simulated Output: ${amountOutNumber} USDC for 1 WETH`);
        expect(amountOutNumber).toBeGreaterThan(1000);
    });

    test('should match simulation vs calculation accurately', async () => {
        const weth = new Token('WETH', 18, new Address(WETH_ADDR));
        const usdc = new Token('USDC', 6, new Address(USDC_ADDR));

        const pairContract = new Contract(POOL_ADDR, PAIR_ABI, provider);
        const [r0, r1] = await pairContract.getReserves();
        const token0Addr = await pairContract.token0();

        let pair: UniswapV2Pair;

        if (token0Addr.toLowerCase() === usdc.address.checksum.toLowerCase()) {
            pair = new UniswapV2Pair(new Address(POOL_ADDR), usdc, weth, r0, r1);
        } else {
            pair = new UniswapV2Pair(new Address(POOL_ADDR), weth, usdc, r0, r1);
        }

        const SIMULATOR_SENDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
        await impersonateAccount(WHALE_ADDR);
        await impersonateAccount(SIMULATOR_SENDER);
        await setBalance(SIMULATOR_SENDER, '10');

        const whaleSigner = await provider.getSigner(WHALE_ADDR);
        const simSigner = await provider.getSigner(SIMULATOR_SENDER);
        const wethContract = new Contract(WETH_ADDR, ERC20_ABI, provider);

        const amountIn = ethers.parseEther('1');

        const wethWhale = wethContract.connect(whaleSigner) as Contract;
        await wethWhale.transfer(SIMULATOR_SENDER, amountIn);

        const wethSim = wethContract.connect(simSigner) as Contract;
        await wethSim.approve(ROUTER_ADDR, ethers.MaxUint256);

        const comparison = await simulator.compareSimulationVsCalculation(pair, amountIn, weth);

        if (comparison.simulated === 0n) {
            console.error('❌ Transaction Reverted during simulation (Output is 0)');
            expect(comparison.simulated).not.toBe(0n);
        }

        const calcVal = comparison.calculated;
        const simVal = comparison.simulated;

        console.log(`Calculated: ${ethers.formatUnits(calcVal, 6)} USDC`);
        console.log(`Simulated:  ${ethers.formatUnits(simVal, 6)} USDC`);

        if (comparison.match) {
            expect(comparison.match).toBe(true);
        } else {
            const diff = calcVal > simVal ? calcVal - simVal : simVal - calcVal;

            const isWithinThreshold = diff * 100n < calcVal;

            if (!isWithinThreshold) {
                const diffFmt = ethers.formatUnits(diff, 6);
                console.log(`Diff: ${diffFmt} (Threshold exceeded 1%)`);
            }

            expect(isWithinThreshold).toBe(true);
        }
    });
});
