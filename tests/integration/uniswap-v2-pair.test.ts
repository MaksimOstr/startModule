import { ethers } from 'ethers';
import { ChainClient } from '../../src/chain/ChainClient';
import { UniswapV2Pair } from '../../src/pricing/UniswapV2Pair';
import { Address } from '../../src/core/types/Address';

describe('UniswapV2Pair fork Mainnet check', () => {
    const RPC_URL = 'http://127.0.0.1:8545';
    const client = new ChainClient([RPC_URL]);

    const pairAddress = new Address('0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc');
    const routerAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

    it('matches JS getAmountOut with EVM callStatic', async () => {
        const jsPair = await UniswapV2Pair.fromChain(pairAddress, client);

        const router = new ethers.Contract(
            routerAddress,
            [
                'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
            ],
            new ethers.JsonRpcProvider(RPC_URL),
        );

        const amountIn = 1n * 10n ** 18n; // 1 WETH
        const path = [jsPair.token0.address.checksum, jsPair.token1.address.checksum];

        const amountsOut = await router.getAmountsOut(amountIn, path);
        const evmAmountOut = BigInt(amountsOut[1].toString());
        const jsAmountOut = jsPair.getAmountOut(amountIn, jsPair.token0);

        console.log('EVM output:', evmAmountOut.toString());
        console.log('JS getAmountOut:', jsAmountOut.toString());

        expect(jsAmountOut).toEqual(evmAmountOut);
    });
});
