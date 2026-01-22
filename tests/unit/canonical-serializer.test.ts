import { CanonicalSerializer } from '../../src/core/CanonicalSerializer';

describe('CanonicalSerializer', () => {
    test('verifyDeterminism() should return true for complex object', () => {
        const complexObject = {
            b: [3, 2, 1],
            a: {
                x: 'hello',
                z: {
                    nestedArray: [
                        { key2: 'v2', key1: 'v1' },
                        { key1: 'v1', key2: 'v2' },
                    ],
                    emptyObj: {},
                },
                y: null,
            },
            c: true,
            d: 42,
        };

        const result = CanonicalSerializer.verifyDeterminism(complexObject, 1000);
        expect(result).toBe(true);
    });

    test('serialize() should sort object keys correctly', () => {
        const obj = { z: 1, a: 2, m: { b: 3, a: 4 } };
        const serialized = CanonicalSerializer.serialize(obj);
        expect(serialized).toBe('{"a":2,"m":{"a":4,"b":3},"z":1}');
    });

    test('hash() should produce a consistent hash', () => {
        const obj = { foo: 'bar', arr: [1, 2, 3] };
        const hash1 = CanonicalSerializer.hash(obj);
        const hash2 = CanonicalSerializer.hash(obj);
        expect(hash1).toBe(hash2);
    });
});
