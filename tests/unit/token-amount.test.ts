import { TokenAmount } from '../../src/core/types/TokenAmount';

describe('TokenAmount', () => {
    test('fromHuman converts string to raw bigint correctly', () => {
        const amount = TokenAmount.fromHuman('1.5', 18);
        expect(amount.raw).toBe(1500000000000000000n);
    });

    test('humanString returns correct string representation', () => {
        const amount = TokenAmount.fromHuman('1.5001', 18);
        expect(amount.humanString).toBe('1.5001');
    });

    test('add works correctly with same decimals', () => {
        const a = TokenAmount.fromHuman('1.0', 18);
        const b = TokenAmount.fromHuman('2.0', 18);
        const sum = a.add(b);
        expect(sum.raw).toBe(3000000000000000000n);
    });

    test('add throws error with different decimals', () => {
        const a = TokenAmount.fromHuman('1.0', 18);
        const b = TokenAmount.fromHuman('1.0', 6);
        expect(() => a.add(b)).toThrow('Cannot add TokenAmounts with different decimals');
    });

    test('mul multiplies correctly without using float', () => {
        const a = TokenAmount.fromHuman('2.5', 18);
        const b = a.mul(2);
        expect(b.raw).toBe(5000000000000000000n);

        const c = a.mul(1.5);
        expect(c.raw).toBe(3750000000000000000n);
    });

    test('toString returns human-readable string with symbol', () => {
        const a = TokenAmount.fromHuman('1.5', 18, 'ETH');
        expect(a.toString()).toBe('1.5 ETH');
    });
});
