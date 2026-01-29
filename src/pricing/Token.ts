import { Address } from '../core/types/Address';

export class Token {
    private readonly _name: string;
    private readonly _decimals: number;
    private readonly _address: Address;

    constructor(name: string, decimals: number, address: Address) {
        this._name = name;
        this._decimals = decimals;
        this._address = address;
    }

    get name(): string {
        return this._name;
    }

    get decimals(): number {
        return this._decimals;
    }

    get address(): Address {
        return this._address;
    }

    equals(other: Token | string): boolean {
        if (typeof other === 'string') {
            return this._address.equals(other);
        } else if (other instanceof Token) {
            return this._address.equals(other.address);
        }
        return false;
    }
    toString(): string {
        return `${this._name} (${this._address.checksum})`;
    }
}
