import { configDotenv } from 'dotenv';

configDotenv();

export type PlatformConfig = {
    apiKey: string;
    secret: string;
    sandbox?: boolean;
    enableRateLimit?: boolean;
    options?: Record<string, unknown>;
};

export const BINANCE_CONFIG: PlatformConfig = {
    apiKey: process.env.BINANCE_TESTNET_API_KEY || '',
    secret: process.env.BINANCE_TESTNET_SECRET || '',
    sandbox: true,
    enableRateLimit: true,
    options: {
        defaultType: 'spot',
    },
};

export const TEST_BINANCE_CONFIG: PlatformConfig = {
    apiKey: process.env.BINANCE_TESTNET_API_KEY || '',
    secret: process.env.BINANCE_TESTNET_SECRET || '',
    sandbox: true,
    enableRateLimit: true,
    options: {
        defaultType: 'spot',
    },
};
