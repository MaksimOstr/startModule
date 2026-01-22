import { FeeData } from 'ethers';
import { ChainClient } from '../../src/chain/ChainClient';
import {
    InsufficientFunds,
    NonceTooLow,
    ReplacementUnderpriced,
    RPCError,
} from '../../src/chain/Errors';
import { Address } from '../../src/core/types/Address';
import { TransactionReceipt } from '../../src/core/types/TransactionReceipt';

const getBalanceMock = jest.fn();
const getTransactionCountMock = jest.fn();
const getFeeDataMock = jest.fn();
const estimateGasMock = jest.fn();
const broadcastTransactionMock = jest.fn();
const getTransactionReceiptMock = jest.fn();
const getTransactionMock = jest.fn();
const callMock = jest.fn();

jest.mock('ethers', () => {
    const original = jest.requireActual('ethers');
    return {
        ...original,
        JsonRpcProvider: jest.fn().mockImplementation(() => ({
            getBalance: getBalanceMock,
            getTransactionCount: getTransactionCountMock,
            getFeeData: getFeeDataMock,
            estimateGas: estimateGasMock,
            broadcastTransaction: broadcastTransactionMock,
            getTransactionReceipt: getTransactionReceiptMock,
            getTransaction: getTransactionMock,
            call: callMock,
        })),
        FetchRequest: jest.fn().mockImplementation(() => ({})),
    };
});

describe('ChainClient', () => {
    let client: ChainClient;
    let address: Address;
    const retryAttempts = 3;

    beforeEach(() => {
        jest.clearAllMocks();
        client = new ChainClient(['https://rpc1'], 1, retryAttempts);
        address = new Address('0x1234567890123456789012345678901234567890');
    });

    test('Instantiation with zero rpcUrls should throw error', () => {
        expect(() => new ChainClient([], 1, 1)).toThrow('At least one RPC URL is required');
    });

    describe('Retry test', () => {
        test('Retry should call method n attempts and throw error after exceeding limit', async () => {
            getBalanceMock.mockRejectedValue(new Error('RPC error'));
            await expect(client.getBalance(address)).rejects.toThrow(RPCError);
            expect(getBalanceMock).toHaveBeenCalledTimes(retryAttempts);
        });

        test('Throws InsufficientFunds immediately', async () => {
            getBalanceMock.mockRejectedValue(new RPCError('test insufficient funds test'));
            await expect(client.getBalance(address)).rejects.toThrow(InsufficientFunds);
            expect(getBalanceMock).toHaveBeenCalledTimes(1);
        });

        test('Throws NonceTooLow immediately', async () => {
            getBalanceMock.mockRejectedValue({ code: 'NONCE_EXPIRED', message: 'nonce too low' });
            await expect(client.getBalance(address)).rejects.toThrow(NonceTooLow);
            expect(getBalanceMock).toHaveBeenCalledTimes(1);
        });

        test('Throws ReplacementUnderpriced immediately', async () => {
            getBalanceMock.mockRejectedValue({
                code: 'REPLACEMENT_UNDERPRICED',
                message: 'replacement transaction underpriced',
            });
            await expect(client.getBalance(address)).rejects.toThrow(ReplacementUnderpriced);
            expect(getBalanceMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('waitForReceipt', () => {
        test('returns receipt immediately if available', async () => {
            const receipt = new TransactionReceipt({
                txHash: '0x123',
                blockNumber: 1,
                status: true,
                gasUsed: 21000n,
                effectiveGasPrice: 1n,
                logs: [],
            });
            client.getReceipt = jest.fn().mockResolvedValue(receipt);

            const promise = client.waitForReceipt('0x123', 10, 1);
            await expect(promise).resolves.toBe(receipt);
            expect(client.getReceipt).toHaveBeenCalledTimes(1);
        });

        test('returns receipt after a few tries', async () => {
            const receipt = new TransactionReceipt({
                txHash: '0x123',
                blockNumber: 1,
                status: true,
                gasUsed: 21000n,
                effectiveGasPrice: 1n,
                logs: [],
            });

            client.getReceipt = jest
                .fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(receipt);

            const promise = client.waitForReceipt('0x123', 10, 1);
            await expect(promise).resolves.toBe(receipt);
            expect(client.getReceipt).toHaveBeenCalledTimes(3);
        });

        test('returns error when timeout exceeded', async () => {
            client.getReceipt = jest.fn().mockResolvedValue(null);

            const promise = client.waitForReceipt('0x123', 2, 1);

            await expect(promise).rejects.toThrow('Transaction 0x123 not confirmed in time');
            expect(client.getReceipt).toHaveBeenCalled();
        });
    });

    describe('getGasPrice()', () => {
        test('Should return GasPrice object with right fees', async () => {
            const mockFeeData: FeeData = {
                maxFeePerGas: 120n,
                maxPriorityFeePerGas: 10n,
                gasPrice: null,
                toJSON: function () {
                    throw new Error('Function not implemented.');
                },
            };

            getFeeDataMock.mockResolvedValue(mockFeeData);

            const gasPrice = await client.getGasPrice();

            expect(gasPrice.baseFee).toBe(
                mockFeeData.maxFeePerGas! - mockFeeData.maxPriorityFeePerGas!,
            );
            expect(gasPrice.priorityFeeLow).toBe(mockFeeData.maxPriorityFeePerGas! / 2n);
            expect(gasPrice.priorityFeeMedium).toBe(10n);
            expect(gasPrice.priorityFeeHigh).toBe((mockFeeData.maxPriorityFeePerGas! * 12n) / 10n);
            expect(getFeeDataMock).toHaveBeenCalledTimes(1);
        });

        test('Throws error when fetch through legacy networks (maxFeePerGas and maxPriorityFeePerGas is null)', async () => {
            const mockFeeData: FeeData = {
                maxFeePerGas: null,
                maxPriorityFeePerGas: null,
                gasPrice: null,
                toJSON: function () {
                    throw new Error('Function not implemented.');
                },
            };

            getFeeDataMock.mockResolvedValue(mockFeeData);

            expect(client.getGasPrice()).resolves.toThrow('Cannot fetch fee data from RPC node');
        });
    });
});
