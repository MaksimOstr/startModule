import Decimal from 'decimal.js';
import { InventoryTracker, Venue } from '../src/inventory/tracker';
import { RebalancePlanner } from '../src/inventory/rebalancer';

type Args = { check: boolean; plan: string | null };

function parseArgs(): Args {
    const flags = new Set(process.argv.slice(2));
    const check = flags.has('--check');
    const planIndex = process.argv.indexOf('--plan');
    const plan = planIndex >= 0 ? (process.argv[planIndex + 1] ?? null) : null;
    return { check, plan };
}

function sampleTracker() {
    const tracker = new InventoryTracker([Venue.BINANCE, Venue.WALLET]);
    tracker.updateFromCex(Venue.BINANCE, {
        ETH: { free: new Decimal('2'), locked: new Decimal(0) },
        USDT: { free: new Decimal('18000'), locked: new Decimal(0) },
    });
    tracker.updateFromWallet(Venue.WALLET, {
        ETH: new Decimal('8'),
        USDT: new Decimal('12000'),
    });
    return tracker;
}

function main() {
    const { check, plan } = parseArgs();
    const tracker = sampleTracker();
    const planner = new RebalancePlanner(tracker);

    if (check || (!check && !plan)) {
        renderCheck(tracker, planner);
        return;
    }

    if (plan) {
        const plans = planner.plan(plan);
        renderPlan(tracker, planner, plan, plans);
    }
}

function renderCheck(tracker: InventoryTracker, planner: RebalancePlanner) {
    const res = planner.checkAll();
    const snap = tracker.snapshot();
    const venues = tracker.getVenues();
    console.log('Inventory Skew Report\n');
    for (const r of res) {
        const asset = r.asset;
        const total = snap.totals[asset] ?? new Decimal(0);
        console.log(`Asset: ${asset}`);
        for (const v of venues) {
            const bal = snap.venues[v]?.[asset];
            const amount = bal ? bal.total : new Decimal(0);
            const pct = total.gt(0) ? amount.div(total).mul(100) : new Decimal(0);
            const target = 100 / venues.length;
            const deviation = pct.sub(target);
            console.log(
                `  ${v[0].toUpperCase() + v.slice(1)}:  ${formatAmount(amount, asset)}  (${pct
                    .toFixed(0)
                    .padStart(
                        2,
                        ' ',
                    )}%)    deviation: ${deviation.greaterThan(0) ? '+' : ''}${deviation
                    .toFixed(0)
                    .padStart(2, ' ')}%`,
            );
        }
        console.log(
            `  Status:   ${r.needsRebalance ? 'NEEDS REBALANCE' : 'OK'}${
                r.needsRebalance ? '' : ` (deviation: ${r.maxDeviationPct.toFixed(0)}%)`
            }`,
        );
        console.log();
    }
}

function renderPlan(
    tracker: InventoryTracker,
    planner: RebalancePlanner,
    asset: string,
    plans: ReturnType<RebalancePlanner['plan']>,
) {
    console.log(`Rebalance Plan: ${asset}\n`);
    if (!plans.length) {
        console.log('No rebalance needed.');
        return;
    }
    const snap = tracker.snapshot();
    const venues = tracker.getVenues();
    plans.forEach((p, i) => {
        console.log(`Transfer ${i + 1}:`);
        console.log(`  From:     ${p.fromVenue}`);
        console.log(`  To:       ${p.toVenue}`);
        console.log(`  Amount:   ${p.amount.toString()} ${p.asset}`);
        const feeUsd = formatFeeUsd(p.asset, p.estimatedFee);
        console.log(
            `  Fee:      ${p.estimatedFee.toString()} ${p.asset}${feeUsd ? ` (${feeUsd})` : ''}`,
        );
        console.log(`  ETA:      ~${p.estimatedTimeMin} min\n`);

        const after = cloneBalances(snap.venues);
        after[p.fromVenue] = after[p.fromVenue] || {};
        after[p.toVenue] = after[p.toVenue] || {};
        const fromBal = after[p.fromVenue][asset] ?? {
            free: new Decimal(0),
            locked: new Decimal(0),
            total: new Decimal(0),
        };
        const toBal = after[p.toVenue][asset] ?? {
            free: new Decimal(0),
            locked: new Decimal(0),
            total: new Decimal(0),
        };
        after[p.fromVenue][asset] = { ...fromBal, total: fromBal.total.sub(p.amount) };
        after[p.toVenue][asset] = { ...toBal, total: toBal.total.add(p.netAmount) };

        const totalAfter = (after[p.fromVenue][asset]?.total ?? new Decimal(0)).add(
            after[p.toVenue][asset]?.total ?? new Decimal(0),
        );
        console.log('  Result:');
        for (const v of venues) {
            const bal = after[v]?.[asset];
            const amount = bal ? bal.total : new Decimal(0);
            const pct = totalAfter.gt(0) ? amount.div(totalAfter).mul(100) : new Decimal(0);
            console.log(
                `    ${v[0].toUpperCase() + v.slice(1)}:  ${formatAmount(amount, asset)} (${pct.toFixed(0)}%)`,
            );
        }
        console.log();
    });
    const cost = planner.estimateCost(plans);
    console.log(
        `Estimated total cost: ${formatFeeUsd(asset, cost.totalFeesUsd) || cost.totalFeesUsd.toString()} (fees), time ~${cost.totalTimeMin} min`,
    );
}

function formatAmount(amount: Decimal, asset: string) {
    const val = amount.toNumber();
    const formatted = val.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
    });
    return `${formatted} ${asset}`;
}

function formatFeeUsd(asset: string, fee: Decimal) {
    const price = asset === 'ETH' ? 2000 : asset === 'USDT' || asset === 'USDC' ? 1 : null;
    if (!price) return '';
    const usd = fee.mul(price);
    return `~$${usd.toFixed(2)}`;
}

function cloneBalances(
    venues: Record<string, Record<string, { free: Decimal; locked: Decimal; total: Decimal }>>,
) {
    const copy: typeof venues = {};
    for (const [venue, assets] of Object.entries(venues)) {
        copy[venue] = {};
        for (const [asset, bal] of Object.entries(assets)) {
            copy[venue][asset] = { free: bal.free, locked: bal.locked, total: bal.total };
        }
    }
    return copy;
}

main();
