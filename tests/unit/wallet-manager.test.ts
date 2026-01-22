import { configDotenv } from 'dotenv';
import { WalletManager } from '../../src/core/WalletManager';
import { TypedDataField } from 'ethers';

configDotenv();

jest.mock('ethers', () => {
    return {
        Wallet: jest.fn().mockImplementation(() => {
            return {
                address: '0xMOCKED_ADDRESS',
                signMessage: jest.fn((msg: string) => Promise.resolve(`signed-${msg}`)),
            };
        }),
        getAddress: jest.requireActual('ethers').getAddress,
    };
});

describe('WalletManager', () => {
    const TEST_PRIVATE_KEY = 'TESTPRIVATEKEY';

    let walletManager: WalletManager;

    beforeEach(() => {
        jest.resetModules();
        delete process.env.PRIVATE_KEY;
        walletManager = new WalletManager(TEST_PRIVATE_KEY);
    });

    test('fromEnv() should throw error if env variable is not present', () => {
        delete process.env.PRIVATE_KEY;
        expect(() => WalletManager.fromEnv('PRIVATE_KEY')).toThrow('PRIVATE_KEY is not set');
    });

    test('fromEnv() should return WalletManager instance', () => {
        process.env.PRIVATE_KEY = TEST_PRIVATE_KEY;
        const manager = WalletManager.fromEnv();
        expect(manager).toBeInstanceOf(WalletManager);
    });

    test('signMessage() should throw exception if we sign empty message', () => {
        expect(() => walletManager.signMessage('')).toThrow('Cannot sign empty message');
    });

    test('signMessage() returns signature if valid message has been signed', async () => {
        const sig = await walletManager.signMessage('test');
        expect(sig).toBe('signed-test');
    });

    test('should throw error if domain, types, or value are invalid', async () => {
        const domain = {};
        const types: Record<string, TypedDataField[]> = {};
        const value = {};

        expect(() => walletManager.signTypedData(domain, types, value)).toThrow(
            'Invalid domain, types, or value for typed data',
        );
    });
});
