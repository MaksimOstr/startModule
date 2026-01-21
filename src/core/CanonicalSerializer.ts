import { keccak256, toUtf8Bytes } from 'ethers';

export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export class CanonicalSerializer {
    private static sortKeys(obj: JsonValue): JsonValue {
        if (Array.isArray(obj)) return obj.map((i) => CanonicalSerializer.sortKeys(i));
        if (obj && typeof obj === 'object') {
            const sortedObj: JsonObject = {};
            Object.keys(obj)
                .sort()
                .forEach((key) => {
                    const value = (obj as JsonObject)[key];
                    if (value !== undefined) sortedObj[key] = CanonicalSerializer.sortKeys(value);
                });
            return sortedObj;
        }
        return obj;
    }

    static serialize(obj: JsonValue): string {
        return JSON.stringify(CanonicalSerializer.sortKeys(obj));
    }

    static hash(obj: JsonValue): string {
        return keccak256(toUtf8Bytes(CanonicalSerializer.serialize(obj)));
    }

    static verifyDeterminism(obj: JsonValue, iterations: number = 100): boolean {
        const first = CanonicalSerializer.serialize(obj);
        for (let i = 1; i < iterations; i++) {
            if (CanonicalSerializer.serialize(obj) !== first) return false;
        }
        return true;
    }
}
