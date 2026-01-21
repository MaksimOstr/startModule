import { getAddress, Transaction, TypedDataField, Wallet } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

export class WalletManager {
    private wallet: Wallet;

    constructor(privateKey: string) {
        this.wallet = new Wallet(privateKey);
    }

    public static fromEnv(): WalletManager {
        const key = process.env.PRIVATE_KEY;
        if (!key) throw new Error('PRIVATE_KEY is not set');

        return new WalletManager(key);
    }

    public static generate(): WalletManager {
        const wallet = Wallet.createRandom();
        console.log(`Your new private key (save it now!): ${wallet.privateKey}`);
        return new WalletManager(wallet.privateKey);
    }

    get address(): string {
        return getAddress(this.wallet.address);
    }

    signMessage(message: string): Promise<string> {
        if (message === '') throw new Error('Cannot sign empty message');
        return this.wallet.signMessage(message);
    }

    signTypedData(
        domain: object,
        types: Record<string, Array<TypedDataField>>,
        value: object,
    ): Promise<string> {
        if (!domain || !types || Object.keys.length === 0 || !value) {
            throw new Error('Invalid domain, types, or value for typed data');
        }

        return this.wallet.signTypedData(domain, types, value);
    }

    signTransaction(tx: Transaction): Promise<string> {
        return this.wallet.signTransaction(tx);
    }

    toString(): string {
        return `WalletManager(address=${this.address})`;
    }
}
