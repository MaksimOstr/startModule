export class TokenAmount {
    private readonly _raw: bigint;
    private readonly decimals: number;
    private readonly symbol?: string;

    constructor(raw: bigint, decimals: number, symbol?: string) {
        this._raw = raw;
        this.decimals = decimals;
        this.symbol = symbol;
    }

    get raw(): bigint {
        return this._raw;
    }

    static fromHuman(amount: string | number, decimals: number, symbol?: string): TokenAmount {
        const amountStr = typeof amount === 'number' ? amount.toString() : amount;
        const [whole, fraction = ''] = amountStr.split('.');
        const normalizedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
        const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(normalizedFraction);
        return new TokenAmount(raw, decimals, symbol);
    }

    get humanString(): string {
        const s = this.raw.toString().padStart(this.decimals + 1, '0');
        const pos = s.length - this.decimals;
        const result = `${s.slice(0, pos)}.${s.slice(pos)}`.replace(/\.?0+$/, '');
        return result === '' || result.startsWith('.') ? `0${result}` : result;
    }

    add(other: TokenAmount): TokenAmount {
        if (this.decimals !== other.decimals) {
            throw new Error('Cannot add TokenAmounts with different decimals');
        }
        return new TokenAmount(this.raw + other.raw, this.decimals, this.symbol);
    }

    mul(factor: number): TokenAmount {
        const factorStr = factor.toString();
        const decimalIndex = factorStr.indexOf('.');
        const factorDecimals = decimalIndex === -1 ? 0 : factorStr.length - decimalIndex - 1;
        const multiplier = BigInt(factorStr.replace('.', ''));
        const resultRaw = (this.raw * multiplier) / 10n ** BigInt(factorDecimals);
        return new TokenAmount(resultRaw, this.decimals, this.symbol);
    }

    toString(): string {
        return `${this.humanString} ${this.symbol ?? ''}`.trim();
    }
}
