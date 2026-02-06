import Decimal from 'decimal.js';
import { InventoryTracker, Venue } from '../../src/inventory/tracker';
import { RebalancePlanner } from '../../src/inventory/rebalancer';

const setupSkewed = () => {
    const tracker = new InventoryTracker([Venue.BINANCE, Venue.WALLET]);
    tracker.updateFromCex(Venue.BINANCE, {
        ETH: { free: new Decimal('2'), locked: new Decimal(0) },
    });
    tracker.updateFromWallet(Venue.WALLET, { ETH: new Decimal('8') });
    return tracker;
};

const setupBalanced = () => {
    const tracker = new InventoryTracker([Venue.BINANCE, Venue.WALLET]);
    tracker.updateFromCex(Venue.BINANCE, {
        ETH: { free: new Decimal('5'), locked: new Decimal(0) },
    });
    tracker.updateFromWallet(Venue.WALLET, { ETH: new Decimal('4') });
    return tracker;
};

describe('RebalancePlanner', () => {
    test('check_detects_skewed_asset', () => {
        const planner = new RebalancePlanner(setupSkewed(), 30);
        const res = planner.checkAll();
        const eth = res.find((r) => r.asset === 'ETH');
        expect(eth?.needsRebalance).toBe(true);
    });

    test('check_passes_balanced_asset', () => {
        const planner = new RebalancePlanner(setupBalanced(), 30);
        const res = planner.checkAll();
        const eth = res.find((r) => r.asset === 'ETH');
        expect(eth?.needsRebalance ?? false).toBe(false);
    });

    test('plan_generates_correct_transfer', () => {
        const planner = new RebalancePlanner(setupSkewed(), 30);
        const plans = planner.plan('ETH');
        expect(plans.length).toBe(1);
        const p = plans[0];
        expect(p.fromVenue).toBe(Venue.WALLET);
        expect(p.toVenue).toBe(Venue.BINANCE);
        expect(p.amount.toString()).toBe(new Decimal('3').toString());
    });

    test('plan_respects_min_operating_balance', () => {
        const tracker = new InventoryTracker([Venue.BINANCE, Venue.WALLET]);
        tracker.updateFromCex(Venue.BINANCE, {
            ETH: { free: new Decimal('0.6'), locked: new Decimal(0) },
        });
        tracker.updateFromWallet(Venue.WALLET, { ETH: new Decimal('5') });
        const planner = new RebalancePlanner(tracker, 10);
        const plans = planner.plan('ETH');
        expect(plans.length).toBe(1);
        expect(plans[0].amount.lt(new Decimal('5'))).toBe(true);
        expect(plans[0].amount.gt(new Decimal('0'))).toBe(true);
    });

    test('plan_accounts_for_fees', () => {
        const planner = new RebalancePlanner(setupSkewed(), 30);
        const plan = planner.plan('ETH')[0];
        expect(plan.netAmount.toString()).toBe(plan.amount.sub(plan.estimatedFee).toString());
    });

    test('plan_empty_when_balanced', () => {
        const planner = new RebalancePlanner(setupBalanced(), 30);
        expect(planner.plan('ETH')).toEqual([]);
    });

    test('estimate_cost_sums_correctly', () => {
        const planner = new RebalancePlanner(setupSkewed(), 30);
        const plans = planner.plan('ETH');
        const cost = planner.estimateCost(plans);
        expect(cost.totalTransfers).toBe(plans.length);
        expect(cost.totalFeesUsd.toString()).toBe(plans[0].estimatedFee.toString());
        expect(cost.totalTimeMin).toBe(plans[0].estimatedTimeMin);
        expect(cost.assetsAffected).toEqual(['ETH']);
    });
});
