import { TransactionReceipt } from '../core/types/TransactionReceipt';

export class ChainError extends Error {
    constructor(message?: string) {
        super(message);
        this.name = 'ChainError';
    }
}

export class RPCError extends ChainError {
    code?: number;

    constructor(message: string, code?: number) {
        super(message);
        this.name = 'RPCError';
        this.code = code;
    }
}

export class TransactionFailed extends ChainError {
    txHash: string;
    receipt: TransactionReceipt;

    constructor(txHash: string, receipt: TransactionReceipt) {
        super(`Transaction ${txHash} reverted`);
        this.name = 'TransactionFailed';
        this.txHash = txHash;
        this.receipt = receipt;
    }
}

export class InsufficientFunds extends ChainError {
    constructor(message: string = 'Not enough balance for transaction') {
        super(message);
        this.name = 'InsufficientFunds';
    }
}

export class NonceTooLow extends ChainError {
    constructor(message: string = 'Nonce already used') {
        super(message);
        this.name = 'NonceTooLow';
    }
}

export class ReplacementUnderpriced extends ChainError {
    constructor(message: string = 'Replacement transaction gas too low') {
        super(message);
        this.name = 'ReplacementUnderpriced';
    }
}
