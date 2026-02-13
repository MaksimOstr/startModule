import Decimal from 'decimal.js';
import { Executor, ExecutorState } from '../../src/executor/engine';
import { Direction, Signal } from '../../src/strategy/signal';
import { ExchangeClient } from '../../src/exchange/ExchangeClient';
import { PricingEngine } from '../../src/pricing/PricingEngine';
import { InventoryTracker } from '../../src/inventory/tracker';

const makeSignal = (overrides: Partial<ConstructorParameters<typeof Signal>[0]> = {}): Signal =>
    new Signal({
        signalId: overrides.signalId ?? 'sig-1',
        pair: overrides.pair ?? 'ETH/USDT',
        direction: overrides.direction ?? Direction.BUY_CEX_SELL_DEX,
        cexPrice: overrides.cexPrice ?? 2000,
        dexPrice: overrides.dexPrice ?? 2010,
        spreadBps: overrides.spreadBps ?? 50,
        size: overrides.size ?? 1,
        expectedGrossPnl: overrides.expectedGrossPnl ?? 20,
        expectedFees: overrides.expectedFees ?? 5,
        expectedNetPnl: overrides.expectedNetPnl ?? 15,
        score: overrides.score ?? 1,
        expiry: overrides.expiry ?? Date.now() / 1000 + 60,
        inventoryOk: overrides.inventoryOk ?? true,
        withinLimits: overrides.withinLimits ?? true,
        timestamp: overrides.timestamp ?? Date.now() / 1000,
    });

describe('Executor', () => {
    let exchange: jest.Mocked<ExchangeClient>;
    let pricing: jest.Mocked<PricingEngine>;
    let inventory: jest.Mocked<InventoryTracker>;

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();

        exchange = {
            createLimitIocOrder: jest.fn(),
            createMarketOrder: jest.fn(),
        } as unknown as jest.Mocked<ExchangeClient>;

        pricing = {
            fetchGasPriceGwei: jest.fn(),
            getQuote: jest.fn(),
        } as unknown as jest.Mocked<PricingEngine>;

        inventory = {} as unknown as jest.Mocked<InventoryTracker>;
    });

    test('test_execute_success', async () => {
        const executor = new Executor(exchange, pricing, inventory, {
            useFlashbots: false,
            simulationMode: true,
        });
        const signal = makeSignal();

        const result = await executor.execute(signal);

        expect(result.state).toBe(ExecutorState.DONE);
        expect(result.error).toBeNull();
        expect(result.leg1FillSize).toBe(1);
        expect(result.leg2FillSize).toBe(1);
    });

    test('test_execute_cex_timeout', async () => {
        const executor = new Executor(exchange, pricing, inventory, {
            useFlashbots: false,
            simulationMode: true,
            leg1Timeout: 0,
        });
        const signal = makeSignal();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const executorInternal = executor as any;

        jest.spyOn(executorInternal, 'executeCexLeg').mockImplementation(
            () => new Promise(() => undefined),
        );

        const result = await executor.execute(signal);

        expect(result.state).toBe(ExecutorState.FAILED);
        expect(result.error).toBe('CEX timeout');
    });

    test('test_execute_dex_failure_unwinds', async () => {
        const executor = new Executor(exchange, pricing, inventory, {
            useFlashbots: false,
            simulationMode: true,
        });
        const signal = makeSignal({ size: new Decimal(2) });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const executorInternal = executor as any;

        jest.spyOn(executorInternal, 'executeCexLeg').mockResolvedValue({
            success: true,
            price: 2000,
            filled: 2,
            orderId: 'ord-1',
        });
        jest.spyOn(executorInternal, 'executeDexLeg').mockResolvedValue({
            success: false,
            price: 0,
            filled: 0,
            error: 'dex failed',
        });
        const unwindSpy = jest.spyOn(executorInternal, 'unwind').mockResolvedValue(undefined);

        const result = await executor.execute(signal);

        expect(unwindSpy).toHaveBeenCalledTimes(1);
        expect(result.state).toBe(ExecutorState.FAILED);
        expect(result.error).toBe('DEX failed - unwound');
    });

    test('test_partial_fill_rejected', async () => {
        const executor = new Executor(exchange, pricing, inventory, {
            useFlashbots: false,
            simulationMode: true,
            minFillRatio: 0.8,
        });
        const signal = makeSignal({ size: 10 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const executorInternal = executor as any;

        jest.spyOn(executorInternal, 'executeCexLeg').mockResolvedValue({
            success: true,
            price: 2000,
            filled: 7,
            orderId: 'ord-2',
        });

        const result = await executor.execute(signal);

        expect(result.state).toBe(ExecutorState.FAILED);
        expect(result.error).toBe('Partial fill below threshold');
    });

    test('test_circuit_breaker_blocks', async () => {
        const executor = new Executor(exchange, pricing, inventory, {
            useFlashbots: false,
            simulationMode: true,
        });
        const signal = makeSignal();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const executorInternal = executor as any;

        executorInternal.circuitBreaker = {
            isOpen: () => true,
            recordSuccess: jest.fn(),
            recordFailure: jest.fn(),
        };

        const result = await executor.execute(signal);

        expect(result.state).toBe(ExecutorState.FAILED);
        expect(result.error).toBe('Circuit breaker open');
    });

    test('test_replay_protection', async () => {
        const executor = new Executor(exchange, pricing, inventory, {
            useFlashbots: false,
            simulationMode: true,
        });
        const signal = makeSignal({ signalId: 'same-id' });

        const first = await executor.execute(signal);
        const second = await executor.execute(signal);

        expect(first.state).toBe(ExecutorState.DONE);
        expect(second.state).toBe(ExecutorState.FAILED);
        expect(second.error).toBe('Duplicate signal');
    });
});
