import { configDotenv } from 'dotenv';

configDotenv({ quiet: true });

export type PlatformConfig = {
    apiKey: string;
    secret: string;
    sandbox?: boolean;
    enableRateLimit?: boolean;
    options?: Record<string, unknown>;
};

const decimalPlaces = (value: number): number => {
    const normalized = value.toString().toLowerCase();
    if (normalized.includes('e-')) {
        const [, exponent] = normalized.split('e-');
        return Number(exponent);
    }
    const parts = normalized.split('.');
    return parts[1]?.length ?? 0;
};

const isTruthy = (value: string | undefined): boolean => {
    if (!value) return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

export class Config {
    static readonly PRODUCTION = isTruthy(process.env.PRODUCTION);

    // Binance (CEX)
    static readonly BINANCE_BASE_URL = Config.PRODUCTION
        ? 'https://api.binance.com'
        : 'https://testnet.binance.vision';
    static readonly BINANCE_WS_URL = Config.PRODUCTION
        ? 'wss://stream.binance.com:9443/ws'
        : 'wss://testnet.binance.vision/ws';
    static readonly DEX_WS_URL = Config.PRODUCTION
        ? process.env.DEX_WS_URL || ''
        : 'ws://localhost:8546';
    static readonly CEX_FEE_BPS = Config.PRODUCTION ? 10.0 : 0.0;

    static readonly ROUTER = '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24';

    static readonly POOL_ADDRESS = '0xF64Dfe17C8b87F012FCf50FbDA1D62bfA148366a';

    // Arbitrum DEX
    static readonly ARBITRUM_RPC = Config.PRODUCTION
        ? (process.env.RPC_URL ?? 'https://arb1.arbitrum.io/rpc')
        : 'https://sepolia-rollup.arbitrum.io/rpc';

    static readonly CHAIN_ID = Config.PRODUCTION ? 42161 : 421614;

    // Trading pair
    static readonly PAIR = 'ETH/USDC';
    static readonly WETH_ADDRESS = Config.PRODUCTION
        ? '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
        : '0x0000000000000000000000000000000000000000';
    static readonly USDC_ADDRESS = Config.PRODUCTION
        ? '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
        : '0x0000000000000000000000000000000000000000';

    static readonly CEX_TAKER_BPS = Config.PRODUCTION ? 10.0 : 0;
    static readonly DEX_SWAP_BPS = 30.0;
    static readonly GAS_COST_USD = 0.1;

    static readonly BINANCE_SECRET = Config.PRODUCTION
        ? process.env.PRODUCTION_BINANCE_SECRET
        : process.env.BINANCE_TESTNET_SECRET;

    static readonly BINANCE_API_KEY = Config.PRODUCTION
        ? process.env.PRODUCTION_BINANCE_API_KEY || ''
        : process.env.BINANCE_TESTNET_API_KEY || '';

    // Execution constraints
    static readonly MIN_NOTIONAL = 5.0;
    static readonly LOT_SIZE_STEP = 0.0001;
    static readonly PRICE_TICK = 0.01;
}

export const MIN_NOTIONAL = Config.MIN_NOTIONAL;
export const LOT_SIZE_STEP = Config.LOT_SIZE_STEP;
export const PRICE_TICK = Config.PRICE_TICK;

export const roundQuantity = (qty: number, step: number = Config.LOT_SIZE_STEP): number => {
    const precision = decimalPlaces(step);
    const rounded = Math.floor(qty / step) * step;
    return Number(rounded.toFixed(precision));
};

export const BINANCE_CONFIG: PlatformConfig = {
    apiKey: Config.BINANCE_API_KEY,
    secret: Config.BINANCE_SECRET!,
    sandbox: !Config.PRODUCTION,
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
