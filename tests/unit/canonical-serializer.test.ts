import { CanonicalSerializer } from '../../src/core/CanonicalSerializer';

describe('CanonicalSerializer', () => {
    test('verifyDeterminism() should return true after big number of iterations', () => {
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

    test('serialize() should produce same output for logically identical objects', () => {
        const complexObject1 = {
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

        const complexObject2 = {
            d: 42,
            c: true,
            a: {
                z: {
                    emptyObj: {},
                    nestedArray: [
                        { key1: 'v1', key2: 'v2' },
                        { key2: 'v2', key1: 'v1' },
                    ],
                },
                y: null,
                x: 'hello',
            },
            b: [3, 2, 1],
        };

        const serialized1 = CanonicalSerializer.serialize(complexObject1);
        const serialized2 = CanonicalSerializer.serialize(complexObject2);

        expect(serialized2).toEqual(serialized1);
    });

    test('hash() should produce a consistent hash', () => {
        const obj = { foo: 'bar', arr: [1, 2, 3] };
        const hash1 = CanonicalSerializer.hash(obj);
        const hash2 = CanonicalSerializer.hash(obj);
        expect(hash1).toBe(hash2);
    });
});
