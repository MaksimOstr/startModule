import { Contract, JsonRpcProvider, formatUnits, parseUnits } from 'ethers';
import { ChainClient } from '../src/chain/ChainClient';
import { Config } from '../src/config';
import { Address } from '../src/core/types/Address';
import { getLogger } from '../src/logger';
import { UniswapV2Pair } from '../src/pricing/UniswapV2Pair';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const FACTORY_ABI = [
    'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

const FACTORIES = [
    {
        name: 'UniswapV2',
        address: '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9',
    },
    {
        name: 'SushiV2',
        address: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
    },
] as const;

type PoolCheck = {
    dex: string;
    factory: string;
    pool: string;
    wethReserve: bigint;
    usdcReserve: bigint;
    thin: boolean;
};

const isZero = (addr: string): boolean => addr.toLowerCase() === ZERO_ADDRESS;

async function main() {
    const logger = getLogger('V2_FACTORY_CHECK');
    logger.info('--- V2 factory fallback check ---');

    const minWethLiquidityEth = process.env.MIN_WETH_LIQUIDITY_ETH || '10';
    const minWethLiquidityWei = parseUnits(minWethLiquidityEth, 18);

    const provider = new JsonRpcProvider(Config.ARBITRUM_RPC);
    const client = new ChainClient([Config.ARBITRUM_RPC], 30, 3, false);

    const weth = Address.fromString(Config.WETH_ADDRESS);
    const usdc = Address.fromString(Config.USDC_ADDRESS);

    const checks: PoolCheck[] = [];

    for (const factoryDef of FACTORIES) {
        const factory = new Contract(factoryDef.address, FACTORY_ABI, provider);
        const pool: string = await factory.getPair(weth.checksum, usdc.checksum);

        if (!pool || isZero(pool)) {
            logger.warn(`${factoryDef.name}: pool not found`);
            continue;
        }

        const pair = await UniswapV2Pair.fromChain(Address.fromString(pool), client);
        const wethReserve = pair.getReserve(weth);
        const usdcReserve = pair.getReserve(usdc);
        const thin = wethReserve < minWethLiquidityWei;

        checks.push({
            dex: factoryDef.name,
            factory: factoryDef.address,
            pool,
            wethReserve,
            usdcReserve,
            thin,
        });
    }

    if (!checks.length) {
        throw new Error(
            `No V2 pool found for ${Config.PAIR}. Check WETH/USDC addresses for chain ${Config.CHAIN_ID}.`,
        );
    }

    const selected =
        checks.find((x) => x.dex === 'UniswapV2' && !x.thin) ??
        checks.find((x) => x.dex === 'SushiV2') ??
        checks[0];

    console.table(
        checks.map((x) => ({
            dex: x.dex,
            factory: x.factory,
            pool: x.pool,
            weth_raw: x.wethReserve.toString(),
            weth: formatUnits(x.wethReserve, 18),
            usdc_raw: x.usdcReserve.toString(),
            usdc: formatUnits(x.usdcReserve, 6),
            thin_liquidity: x.thin ? 'YES' : 'NO',
        })),
    );

    logger.info(`Selected: ${selected.dex} ${selected.pool}`);
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
});
