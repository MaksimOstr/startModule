import { ethers } from 'ethers';
import { MempoolMonitor, ParsedSwap } from '../../src/pricing/MempoolMonitor';

jest.mock('ethers', () => {
    const actualEthers = jest.requireActual('ethers');
    return {
        ...actualEthers,
        ethers: {
            ...actualEthers.ethers,
            WebSocketProvider: jest.fn().mockImplementation(() => ({
                on: jest.fn(),
                getTransaction: jest.fn(),
                destroy: jest.fn(),
            })),
        },
    };
});

describe('MempoolMonitor Parsing', () => {
    let mempoolWatcher: MempoolMonitor;

    const UNISWAP_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
    const TX_SENDER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

    beforeEach(() => {
        jest.clearAllMocks();
        mempoolWatcher = new MempoolMonitor('wss://dummy-node', () => {});
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractSwapData = (tx: any): ParsedSwap | null => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (mempoolWatcher as any).parseTransaction(tx);
    };

    test('should return null for invalid or irrelevant transactions', () => {
        const txCandidate = {
            hash: '0x' + '0'.repeat(64),
            to: UNISWAP_ROUTER,
            from: TX_SENDER,
            value: 10n * 10n ** 18n,
            gasPrice: 20n * 10n ** 9n,
            data: '0x',
        };

        expect(extractSwapData(txCandidate)).toBeNull();

        txCandidate.data = '0xa9059cbb' + '0'.repeat(64);
        expect(extractSwapData(txCandidate)).toBeNull();

        txCandidate.data = '0x7ff36ab5' + '1234';
        expect(extractSwapData(txCandidate)).toBeNull();
    });

    test('should successfully parse a valid Uniswap V2 swap transaction', () => {
        const inputAmount = 10n * 10n ** 18n;
        const minOutputAmount = 20000n * 10n ** 6n;
        const expiry = 1234567890;
        const tokenPath = [WETH_ADDRESS, USDC_ADDRESS];
        const recipient = '0x1234567890123456789012345678901234567890';
        const txGasPrice = 50n * 10n ** 9n;

        const abiCoder = new ethers.Interface([
            'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)',
        ]);

        const encodedPayload = abiCoder.encodeFunctionData('swapExactTokensForTokens', [
            inputAmount,
            minOutputAmount,
            tokenPath,
            recipient,
            expiry,
        ]);

        const validTx = {
            hash: '0x' + '1'.repeat(64),
            to: UNISWAP_ROUTER,
            from: TX_SENDER,
            value: 0n,
            gasPrice: txGasPrice,
            data: encodedPayload,
        };

        const result = extractSwapData(validTx);

        expect(result).not.toBeNull();
        if (!result) throw new Error('Parsing failed');

        expect(result.dex).toBe('UniswapV2');
        expect(result.method).toBe('swapExactTokensForTokens');
        expect(result.amount_in).toBe(inputAmount);
        expect(result.min_amount_out).toBe(minOutputAmount);
        expect(result.deadline).toBe(expiry);
        expect(result.gas_price).toBe(txGasPrice);
        expect(result.token_in).toBe(WETH_ADDRESS);
        expect(result.token_out).toBe(USDC_ADDRESS);
        expect(result.sender).toBe(TX_SENDER);
    });
});
