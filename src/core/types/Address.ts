import { getAddress } from 'ethers';

export class Address {
    private value: string;

    constructor(value: string) {
        try {
            this.value = getAddress(value);
        } catch {
            throw new Error(`Invalid Ethereum address: ${value}`);
        }
    }

    static fromString(value: string): Address {
        return new Address(value);
    }

    get checksum(): string {
        return this.value;
    }

    get lower(): string {
        return this.value.toLowerCase();
    }

    equals(other: Address | string): boolean {
        if (typeof other === 'string') {
            try {
                return this.lower === getAddress(other).toLowerCase();
            } catch {
                return false;
            }
        } else if (other instanceof Address) {
            return this.lower === other.lower;
        }
        return false;
    }
}
