import { formatUnits } from 'ethers';
import { ChainClient } from '../src/chain/ChainClient';
import { BINANCE_CONFIG, Config } from '../src/config';
import { Address } from '../src/core/types/Address';
import { getLogger } from '../src/logger';
import { UniswapV2Pair } from '../src/pricing/UniswapV2Pair';
import { ExchangeClient } from '../src/exchange/ExchangeClient';

async function main() {
    const logger = getLogger('READINESS_CHECK');
    logger.info('--- DEX readiness check ---');

    const client = new ChainClient([Config.ARBITRUM_RPC], 30, 3, false);
    const poolAddress = Address.fromString(Config.POOL_ADDRESS);
    const pair = await UniswapV2Pair.fromChain(poolAddress, client);

    const wethAddress = Address.fromString(Config.WETH_ADDRESS);
    const usdcAddress = Address.fromString(Config.USDC_ADDRESS);
    const wethReserve = pair.getReserve(wethAddress);
    const usdcReserve = pair.getReserve(usdcAddress);

    console.log(`WETH reserves: ${wethReserve.toString()} (${formatUnits(wethReserve, 18)} WETH)`);
    console.log(`USDC reserves: ${usdcReserve.toString()} (${formatUnits(usdcReserve, 6)} USDC)`);

    logger.info('--- CEX readiness check ---');

    const exchangeClient = new ExchangeClient(BINANCE_CONFIG, false);
    await exchangeClient.init();
    const orderBook = await exchangeClient.fetchOrderBook('ETH/USDT');

    logger.info(`Best bid: ${orderBook.best_bid[0]}`);
    logger.info(`Best ask: ${orderBook.best_ask[0]}`);
}

main();
