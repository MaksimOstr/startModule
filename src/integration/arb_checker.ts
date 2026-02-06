import Decimal from 'decimal.js';
import { ChainClient } from '../chain/ChainClient';
import { Address } from '../core/types/Address';
import { ExchangeClient } from '../exchange/ExchangeClient';
import { InventoryTracker, Venue } from '../inventory/tracker';
import { OrderBookAnalyzer } from '../exchange/OrderBookAnalyzer';
import { UniswapV2Pair } from '../pricing/UniswapV2Pair';

export type ArbCheckResult = {
    pair: string;
    timestamp: Date;
    dex_price: Decimal;
    cex_bid: Decimal;
    cex_ask: Decimal;
    gap_bps: Decimal;
    direction: 'buy_dex_sell_cex' | 'buy_cex_sell_dex' | null;
    estimated_costs_bps: Decimal;
    estimated_net_pnl_bps: Decimal;
    inventory_ok: boolean;
    executable: boolean;
    details: {
        dex_price_impact_bps: Decimal;
        cex_slippage_bps: Decimal;
        cex_fee_bps: Decimal;
        dex_fee_bps: Decimal;
        gas_cost_usd: Decimal;
        gas_bps: Decimal;
    };
    inventory_details: {
        wallet_asset: string;
        wallet_bal: Decimal;
        wallet_need: Decimal;
        cex_asset: string;
        cex_bal: Decimal;
        cex_need: Decimal;
    };
};

const POOL_ADDRESSES: Record<string, string> = {
    'ETH/USDT': '0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852',
};

export class ArbChecker {
    constructor(
        private chainClient: ChainClient,
        private exchangeClient: ExchangeClient,
        private inventoryTracker: InventoryTracker,
    ) {}

    async check(pair: string, size: Decimal): Promise<ArbCheckResult> {
        const dexQuote = await this.quoteDex(pair, size);
        const ob = await this.exchangeClient.fetchOrderBook(pair, 50);
        const analyzer = new OrderBookAnalyzer(ob);

        const cexBid = ob.best_bid[0];
        const cexAsk = ob.best_ask[0];
        const gapBuyDex = cexBid.sub(dexQuote.price);
        const gapBuyCex = dexQuote.price.sub(cexAsk);

        let direction: ArbCheckResult['direction'] = null;
        let gapBps = new Decimal(0);
        if (gapBuyDex.gt(0)) {
            direction = 'buy_dex_sell_cex';
            gapBps = gapBuyDex.div(dexQuote.price).mul(10_000);
        } else if (gapBuyCex.gt(0)) {
            direction = 'buy_cex_sell_dex';
            gapBps = gapBuyCex.div(cexAsk).mul(10_000);
        }

        const { cex_slippage_bps } = this.estimateCexSlippage(analyzer, size, direction);
        const costs = dexQuote.fee_bps
            .add(dexQuote.price_impact_bps)
            .add(cex_slippage_bps)
            .add(dexQuote.cex_fee_bps);
        const gasBps = this.gasToBps(
            dexQuote.gas_cost_usd,
            size,
            direction === 'buy_dex_sell_cex' ? dexQuote.price : cexAsk,
        );
        const totalCosts = costs.add(gasBps);
        const netBps = gapBps.sub(totalCosts);

        const base = pair.split('/')[0];
        const quote = pair.split('/')[1];
        let walletAsset: string;
        let walletNeed: Decimal;
        let cexAsset: string;
        let cexNeed: Decimal;
        const cexPrice = direction === 'buy_dex_sell_cex' ? cexBid : cexAsk;
        if (direction === 'buy_dex_sell_cex') {
            walletAsset = quote;
            walletNeed = size.mul(dexQuote.price);
            cexAsset = base;
            cexNeed = size;
        } else {
            walletAsset = base;
            walletNeed = size;
            cexAsset = quote;
            cexNeed = size.mul(cexPrice);
        }
        const walletBal = this.inventoryTracker.getAvailable(Venue.WALLET, walletAsset);
        const cexBal = this.inventoryTracker.getAvailable(Venue.BINANCE, cexAsset);
        const inventoryOk =
            direction !== null &&
            walletBal.greaterThanOrEqualTo(walletNeed) &&
            cexBal.greaterThanOrEqualTo(cexNeed);
        const executable = direction !== null && netBps.gt(0) && inventoryOk;

        return {
            pair,
            timestamp: new Date(),
            dex_price: dexQuote.price,
            cex_bid: cexBid,
            cex_ask: cexAsk,
            gap_bps: gapBps,
            direction,
            estimated_costs_bps: totalCosts,
            estimated_net_pnl_bps: netBps,
            inventory_ok: inventoryOk,
            executable,
            details: {
                dex_price_impact_bps: dexQuote.price_impact_bps,
                cex_slippage_bps,
                cex_fee_bps: dexQuote.cex_fee_bps,
                dex_fee_bps: dexQuote.fee_bps,
                gas_cost_usd: dexQuote.gas_cost_usd,
                gas_bps: gasBps,
            },
            inventory_details: {
                wallet_asset: walletAsset,
                wallet_bal: walletBal,
                wallet_need: walletNeed,
                cex_asset: cexAsset,
                cex_bal: cexBal,
                cex_need: cexNeed,
            },
        };
    }

    private async quoteDex(pair: string, size: Decimal) {
        const pool = POOL_ADDRESSES[pair];
        if (!pool) throw new Error(`Unknown pool for pair ${pair}`);

        const poolAddress = Address.fromString(pool);
        const uniPair = await UniswapV2Pair.fromChain(poolAddress, this.chainClient);

        const wethAddr = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
        const isToken0Weth =
            uniPair.token0.address.checksum.toLowerCase() === wethAddr.toLowerCase();

        const dec0 = new Decimal(10).pow(uniPair.token0.decimals);
        const dec1 = new Decimal(10).pow(uniPair.token1.decimals);
        const reserve0 = new Decimal(uniPair.reserve0.toString()).div(dec0);
        const reserve1 = new Decimal(uniPair.reserve1.toString()).div(dec1);

        const reserveWeth = isToken0Weth ? reserve0 : reserve1;
        const reserveQuote = isToken0Weth ? reserve1 : reserve0;

        const price = reserveQuote.div(reserveWeth);
        const price_impact_bps = reserveWeth.gt(0)
            ? size.div(reserveWeth).mul(10_000)
            : new Decimal(0);
        const fee_bps = new Decimal(uniPair.feeBps.toString());

        const gasPrice = await this.chainClient.getGasPrice();
        const gasLimit = 200_000n;
        const maxFeeWei = gasPrice.getMaxFee();
        const gasEth = new Decimal(maxFeeWei.toString())
            .mul(new Decimal(gasLimit.toString()))
            .div(new Decimal(10).pow(18));
        const gas_cost_usd = gasEth.mul(price);
        return {
            price,
            fee_bps,
            price_impact_bps,
            cex_fee_bps: new Decimal('10'),
            gas_cost_usd,
        };
    }

    private estimateCexSlippage(
        analyzer: OrderBookAnalyzer,
        size: Decimal,
        direction: ArbCheckResult['direction'],
    ) {
        if (!direction) return { cex_slippage_bps: new Decimal(0) };
        const side = direction === 'buy_cex_sell_dex' ? 'buy' : 'sell';
        const res = analyzer.walkTheBook(side, size.toNumber());
        return { cex_slippage_bps: res.slippage_bps ?? new Decimal(0) };
    }

    private gasToBps(gasUsd: Decimal, size: Decimal, price: Decimal) {
        const notional = size.mul(price);
        if (notional.eq(0)) return new Decimal(0);
        return gasUsd.div(notional).mul(10_000);
    }
}
