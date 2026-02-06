import Decimal from 'decimal.js';
import { InventoryTracker, Venue } from './tracker';

export type TransferPlan = {
    fromVenue: Venue;
    toVenue: Venue;
    asset: string;
    amount: Decimal;
    estimatedFee: Decimal;
    estimatedTimeMin: number;
    netAmount: Decimal;
};

const TRANSFER_FEES: Record<
    string,
    {
        withdrawalFee: Decimal;
        minWithdrawal: Decimal;
        confirmations: number;
        estimatedTimeMin: number;
    }
> = {
    ETH: {
        withdrawalFee: new Decimal('0.005'),
        minWithdrawal: new Decimal('0.01'),
        confirmations: 12,
        estimatedTimeMin: 15,
    },
    USDT: {
        withdrawalFee: new Decimal('1.0'),
        minWithdrawal: new Decimal('10.0'),
        confirmations: 12,
        estimatedTimeMin: 15,
    },
    USDC: {
        withdrawalFee: new Decimal('1.0'),
        minWithdrawal: new Decimal('10.0'),
        confirmations: 12,
        estimatedTimeMin: 15,
    },
};

const MIN_OPERATING_BALANCE: Record<string, Decimal> = {
    ETH: new Decimal('0.5'),
    USDT: new Decimal('500'),
    USDC: new Decimal('500'),
};

export class RebalancePlanner {
    private readonly tracker: InventoryTracker;
    private readonly thresholdPct: number;
    private readonly targetRatio: Record<Venue, number>;

    constructor(
        tracker: InventoryTracker,
        thresholdPct = 30.0,
        targetRatio: Record<Venue, number> | null = null,
    ) {
        this.tracker = tracker;
        this.thresholdPct = thresholdPct;
        const venues = tracker.getVenues();
        if (targetRatio) {
            this.targetRatio = targetRatio;
        } else {
            const equal = 1 / venues.length;
            this.targetRatio = venues.reduce(
                (acc, v) => {
                    acc[v] = equal;
                    return acc;
                },
                {} as Record<Venue, number>,
            );
        }
    }

    checkAll() {
        const snap = this.tracker.snapshot();
        const assets = Object.keys(snap.totals);
        const results: { asset: string; maxDeviationPct: number; needsRebalance: boolean }[] = [];
        for (const asset of assets) {
            const info = this.computeSkew(asset);
            results.push({
                asset,
                maxDeviationPct: info.maxDeviationPct,
                needsRebalance: info.maxDeviationPct >= this.thresholdPct,
            });
        }
        return results;
    }

    plan(asset: string): TransferPlan[] {
        const skew = this.computeSkew(asset);
        if (skew.maxDeviationPct < this.thresholdPct) return [];
        const venues = this.tracker.getVenues();
        if (venues.length < 2) return [];

        const perVenue = this.currentByVenue(asset);
        const total = perVenue.reduce((s, v) => s.add(v.amount), new Decimal(0));
        if (total.eq(0)) return [];

        const targetAmounts = perVenue.map((v) => ({
            venue: v.venue,
            target: total.mul(this.targetRatio[v.venue]),
        }));

        const deltas = perVenue.map((v) => {
            const target = targetAmounts.find((t) => t.venue === v.venue)!.target;
            return { venue: v.venue, current: v.amount, delta: v.amount.sub(target) };
        });

        const source = deltas.reduce((max, d) => (d.delta.gt(max.delta) ? d : max), deltas[0]);
        const dest = deltas.reduce((min, d) => (d.delta.lt(min.delta) ? d : min), deltas[0]);
        if (!source || !dest) return [];
        if (source.delta.lte(0) || dest.delta.gte(0)) return [];

        const feeInfo = TRANSFER_FEES[asset];
        const fee = feeInfo ? feeInfo.withdrawalFee : new Decimal(0);
        const minWithdraw = feeInfo ? feeInfo.minWithdrawal : new Decimal(0);
        const eta = feeInfo ? feeInfo.estimatedTimeMin : 0;
        const minOp = MIN_OPERATING_BALANCE[asset] ?? new Decimal(0);

        const desired = Decimal.min(source.delta, dest.delta.neg());
        const maxByMinOp = Decimal.max(source.current.sub(minOp), new Decimal(0));
        const amount = Decimal.min(desired, maxByMinOp);
        if (amount.lt(minWithdraw) || amount.lte(0)) return [];

        const plan: TransferPlan = {
            fromVenue: source.venue,
            toVenue: dest.venue,
            asset,
            amount,
            estimatedFee: fee,
            estimatedTimeMin: eta,
            netAmount: amount.sub(fee),
        };
        if (plan.netAmount.lte(0)) return [];
        return [plan];
    }

    planAll() {
        const results: Record<string, TransferPlan[]> = {};
        const snap = this.tracker.snapshot();
        for (const asset of Object.keys(snap.totals)) {
            const p = this.plan(asset);
            if (p.length) results[asset] = p;
        }
        return results;
    }

    estimateCost(plans: TransferPlan[]) {
        const totalFees = plans.reduce((s, p) => s.add(p.estimatedFee), new Decimal(0));
        const totalTime = plans.reduce((m, p) => Math.max(m, p.estimatedTimeMin), 0);
        const assets = Array.from(new Set(plans.map((p) => p.asset)));
        return {
            totalTransfers: plans.length,
            totalFeesUsd: totalFees,
            totalTimeMin: totalTime,
            assetsAffected: assets,
        };
    }

    private currentByVenue(asset: string) {
        const snap = this.tracker.snapshot();
        const venues = this.tracker.getVenues();
        return venues.map((v) => {
            const bal = snap.venues[v]?.[asset];
            const amount = bal ? bal.total : new Decimal(0);
            return { venue: v, amount };
        });
    }

    private computeSkew(asset: string) {
        const perVenue = this.currentByVenue(asset);
        const total = perVenue.reduce((s, v) => s.add(v.amount), new Decimal(0));
        let maxDev = 0;
        for (const pv of perVenue) {
            const pct = total.gt(0) ? pv.amount.div(total).mul(100).toNumber() : 0;
            const targetPct = (this.targetRatio[pv.venue] ?? 0) * 100;
            const dev = Math.abs(pct - targetPct);
            if (dev > maxDev) maxDev = dev;
        }
        return { maxDeviationPct: maxDev };
    }
}
