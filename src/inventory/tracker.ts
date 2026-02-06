import Decimal from 'decimal.js';

export enum Venue {
    BINANCE = 'binance',
    WALLET = 'wallet',
}

export type Balance = {
    venue: Venue;
    asset: string;
    free: Decimal;
    locked: Decimal;
};

export class InventoryTracker {
    private readonly venues: Set<Venue>;
    private readonly balances: Map<Venue, Balance[]>;

    constructor(venues: Venue[]) {
        this.venues = new Set(venues);
        this.balances = new Map();
        for (const v of this.venues) this.balances.set(v, []);
    }

    getVenues(): Venue[] {
        return Array.from(this.venues);
    }

    updateFromCex(
        venue: Venue,
        balances: Record<string, { free: Decimal.Value; locked: Decimal.Value }>,
    ) {
        this.assertVenue(venue);
        const store: Balance[] = [];
        for (const [asset, bal] of Object.entries(balances)) {
            const free = new Decimal(bal.free ?? 0);
            const locked = new Decimal(bal.locked ?? 0);
            store.push({ venue, asset, free, locked });
        }
        this.balances.set(venue, store);
    }

    updateFromWallet(venue: Venue, balances: Record<string, Decimal.Value>) {
        this.assertVenue(venue);
        const store: Balance[] = [];
        for (const [asset, amount] of Object.entries(balances)) {
            const free = new Decimal(amount ?? 0);
            store.push({ venue, asset, free, locked: new Decimal(0) });
        }
        this.balances.set(venue, store);
    }

    snapshot() {
        const venues: Record<
            string,
            Record<string, { free: Decimal; locked: Decimal; total: Decimal }>
        > = {};
        const totals: Record<string, Decimal> = {};

        for (const [venue, list] of this.balances.entries()) {
            venues[venue] = {};
            for (const bal of list) {
                const total = bal.free.add(bal.locked);
                venues[venue][bal.asset] = { free: bal.free, locked: bal.locked, total };
                totals[bal.asset] = (totals[bal.asset] ?? new Decimal(0)).add(total);
            }
        }

        return {
            timestamp: new Date(),
            venues,
            totals,
            totalUsd: null as Decimal | null,
        };
    }

    getAvailable(venue: Venue, asset: string): Decimal {
        this.assertVenue(venue);
        const bal = this.balances.get(venue)?.find((b) => b.asset === asset);
        return bal ? bal.free : new Decimal(0);
    }

    canExecute(
        buyVenue: Venue,
        buyAsset: string,
        buyAmount: Decimal,
        sellVenue: Venue,
        sellAsset: string,
        sellAmount: Decimal,
    ) {
        const buyAvailable = this.getAvailable(buyVenue, buyAsset);
        const sellAvailable = this.getAvailable(sellVenue, sellAsset);
        if (buyAvailable.lt(buyAmount)) {
            return {
                canExecute: false,
                buyVenueAvailable: buyAvailable,
                buyVenueNeeded: buyAmount,
                sellVenueAvailable: sellAvailable,
                sellVenueNeeded: sellAmount,
                reason: 'insufficientBuyBalance',
            };
        }
        if (sellAvailable.lt(sellAmount)) {
            return {
                canExecute: false,
                buyVenueAvailable: buyAvailable,
                buyVenueNeeded: buyAmount,
                sellVenueAvailable: sellAvailable,
                sellVenueNeeded: sellAmount,
                reason: 'insufficientSellBalance',
            };
        }
        return {
            canExecute: true,
            buyVenueAvailable: buyAvailable,
            buyVenueNeeded: buyAmount,
            sellVenueAvailable: sellAvailable,
            sellVenueNeeded: sellAmount,
            reason: null as string | null,
        };
    }

    recordTrade(
        venue: Venue,
        side: 'buy' | 'sell',
        baseAsset: string,
        quoteAsset: string,
        baseAmount: Decimal,
        quoteAmount: Decimal,
        fee: Decimal,
        feeAsset: string,
    ) {
        this.assertVenue(venue);
        const list = this.balances.get(venue)!;
        const base = this.ensureAsset(list, venue, baseAsset);
        const quote = this.ensureAsset(list, venue, quoteAsset);
        if (side === 'buy') {
            base.free = base.free.add(baseAmount);
            quote.free = quote.free.sub(quoteAmount);
        } else {
            base.free = base.free.sub(baseAmount);
            quote.free = quote.free.add(quoteAmount);
        }
        const feeBal = this.ensureAsset(list, venue, feeAsset);
        feeBal.free = feeBal.free.sub(fee);
    }

    skew(asset: string) {
        const venuesResult: Record<string, { amount: Decimal; pct: number; deviationPct: number }> =
            {};
        let total = new Decimal(0);
        for (const list of this.balances.values()) {
            const bal = list.find((b) => b.asset === asset);
            if (bal) total = total.add(bal.free).add(bal.locked);
        }

        const evenPct = this.venues.size ? 100 / this.venues.size : 0;
        let maxDev = 0;
        for (const [venue, list] of this.balances.entries()) {
            const bal = list.find((b) => b.asset === asset);
            const amount = bal ? bal.free.add(bal.locked) : new Decimal(0);
            const pct = total.gt(0) ? amount.div(total).mul(100).toNumber() : 0;
            const dev = Math.abs(pct - evenPct);
            maxDev = Math.max(maxDev, dev);
            venuesResult[venue] = { amount, pct, deviationPct: dev };
        }

        return {
            asset,
            total,
            venues: venuesResult,
            maxDeviationPct: maxDev,
            needsRebalance: maxDev >= 30,
        };
    }

    private ensureAsset(store: Balance[], venue: Venue, asset: string): Balance {
        let bal = store.find((b) => b.asset === asset);
        if (!bal) {
            bal = { venue, asset, free: new Decimal(0), locked: new Decimal(0) };
            store.push(bal);
        }
        return bal;
    }

    private assertVenue(venue: Venue) {
        if (!this.venues.has(venue)) throw new Error(`Unknown venue ${venue}`);
    }
}
