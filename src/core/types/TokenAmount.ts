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
        return this.raw;
    }

    static fromHuman(amount: string, decimals: number, symbol?: string): TokenAmount {
        const [whole, fraction = ''] = amount.split('.');
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
        const factorStr = factor.toString().replace('.', '');
        const factorDecimals = factorStr.length - factor.toString().indexOf('.') - 1 || 0;
        const multiplier = BigInt(factorStr);
        const resultRaw = (this.raw * multiplier) / 10n ** BigInt(factorDecimals);
        return new TokenAmount(resultRaw, this.decimals, this.symbol);
    }

    toString(): string {
        return `${this.humanString} ${this.symbol ?? ''}`.trim();
    }
}
