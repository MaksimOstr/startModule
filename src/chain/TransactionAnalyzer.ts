import { formatEther, formatUnits, getAddress, AbiCoder } from 'ethers';
import { TokenAmount } from '../core/types/TokenAmount';
import { configDotenv } from 'dotenv';
import { ChainClient } from './ChainClient';

configDotenv();

const KNOWN_SELECTORS: Record<string, { name: string; types: string[] }> = {
    '0xa9059cbb': { name: 'transfer', types: ['address', 'uint256'] },
    '0x095ea7b3': { name: 'approve', types: ['address', 'uint256'] },
    '0x23b872dd': { name: 'transferFrom', types: ['address', 'address', 'uint256'] },
    '0x38ed1739': {
        name: 'swapExactTokensForTokens',
        types: ['uint256', 'uint256', 'address[]', 'address', 'uint256'],
    },
    '0x7ff36ab5': {
        name: 'swapExactETHForTokens',
        types: ['uint256', 'address[]', 'address', 'uint256'],
    },
    '0x18cbafe5': {
        name: 'swapExactTokensForETH',
        types: ['uint256', 'uint256', 'address[]', 'address', 'uint256'],
    },
    '0xb6f9de95': {
        name: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
        types: ['uint256', 'address[]', 'address', 'uint256'],
    },
    '0x5ae401dc': { name: 'multicall', types: ['bytes[]'] },
};

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export class TransactionAnalyzer {
    private chainClient: ChainClient;
    private abiCoder: AbiCoder;

    constructor(rpcUrl: string) {
        this.chainClient = new ChainClient([rpcUrl]);
        this.abiCoder = new AbiCoder();
    }

    async analyze(txHash: string) {
        const tx = await this.chainClient.getTransaction(txHash);
        if (!tx) throw new Error(`Transaction ${txHash} not found`);

        const receipt = await this.chainClient.getReceipt(txHash);
        if (!receipt) throw new Error(`Transaction receipt for ${txHash} not found`);

        const block = await tx.getBlock();

        console.log(`Transaction Analysis`);
        console.log(`====================`);
        console.log(`Hash:           ${txHash}`);
        console.log(`Block:          ${receipt.blockNumber}`);
        console.log(`Timestamp:      ${new Date(block!.timestamp * 1000).toUTCString()}`);
        console.log(`Status:         ${receipt.status === true ? 'SUCCESS' : 'FAILED'}`);
        console.log('');
        console.log(`From:           ${tx.from}`);
        console.log(`To:             ${tx.to}`);
        console.log(`Value:          ${formatEther(tx.value)} ETH`);
        console.log('');

        console.log(`Gas Analysis`);
        console.log(`------------`);

        const baseFee = new TokenAmount(tx.gasPrice - tx.maxPriorityFeePerGas!, 9, 'ETH');
        const gasUsedPercent = (Number(receipt.gasUsed) / Number(tx.gasLimit)) * 100;
        const txFee = new TokenAmount(receipt.gasUsed * receipt.effectiveGasPrice, 18, 'ETH');
        const priorityFee = new TokenAmount(tx.maxPriorityFeePerGas!, 9, 'ETH');
        const effectivePrice = new TokenAmount(receipt.effectiveGasPrice, 9, 'ETH');

        console.log(`Gas Limit:       ${tx.gasLimit}`);
        console.log(`Gas Used:        ${receipt.gasUsed} (${gasUsedPercent.toFixed(2)}%)`);
        console.log(`Base Fee:        ${baseFee.humanString} gwei`);
        console.log(`Priority Fee:    ${priorityFee.humanString} gwei`);
        console.log(`Effective Price: ${effectivePrice.humanString} gwei`);
        console.log(`Transaction Fee: ${txFee.humanString} ETH`);
        console.log('');

        console.log(`Function Called`);
        console.log(`---------------`);
        const inputData = tx.data || '0x';
        if (inputData.length < 10 || inputData === '0x') {
            console.log('Native ETH Transfer');
        } else {
            const selector = inputData.slice(0, 10);
            const funcInfo = KNOWN_SELECTORS[selector];
            if (funcInfo) {
                console.log(`Selector:       ${selector}`);
                console.log(`Function:       ${funcInfo.name}(${funcInfo.types.join(',')})`);
                try {
                    const data = '0x' + inputData.slice(10);
                    const decoded = this.abiCoder.decode(funcInfo.types, data);
                    console.log('Arguments:');
                    funcInfo.types.forEach((type, i) => {
                        let val = decoded[i];
                        if (type === 'address') val = getAddress(val);
                        console.log(`  - ${type}: ${val.toString()}`);
                    });
                } catch {
                    console.log('  (Arguments decoding failed)');
                }
            } else {
                console.log(`Selector:       ${selector}`);
                console.log('Function:       Unknown');
            }
        }

        console.log('');
        console.log('Token Transfers');
        console.log('---------------');

        const assetsSent: Record<string, bigint> = {};
        const assetsReceived: Record<string, bigint> = {};
        const sender = tx.from.toLowerCase();
        let transfersFound = false;

        for (const log of receipt.logs) {
            if (
                log.topics.length === 3 &&
                log.topics[0].toLowerCase() === TRANSFER_TOPIC.toLowerCase()
            ) {
                const from = getAddress('0x' + log.topics[1].slice(-40));
                const to = getAddress('0x' + log.topics[2].slice(-40));
                const amount = BigInt(log.data);
                console.log(
                    `Token: ${log.address.slice(0, 10)}..., From: ${from.slice(0, 10)}..., To: ${to.slice(0, 10)}..., Amount: ${formatUnits(amount, 18)}`,
                );
                transfersFound = true;

                if (from.toLowerCase() === sender)
                    assetsSent[log.address] = (assetsSent[log.address] || 0n) + amount;
                if (to.toLowerCase() === sender)
                    assetsReceived[log.address] = (assetsReceived[log.address] || 0n) + amount;
            }
        }

        if (!transfersFound) console.log('No ERC-20 transfers found');

        if (Object.keys(assetsSent).length || Object.keys(assetsReceived).length || tx.value > 0n) {
            console.log('\nSwap Summary');
            console.log('------------');
            for (const token in assetsSent)
                console.log(`Sold:      ${formatUnits(assetsSent[token], 18)} of ${token}`);
            for (const token in assetsReceived)
                console.log(`Received:  ${formatUnits(assetsReceived[token], 18)} of ${token}`);
            if (tx.value > 0n) console.log(`Sold:      ${formatEther(tx.value)} ETH (Native)`);
        }
    }
}

const txHash = process.argv[2];
if (!txHash) {
    console.error('Please provide a transaction hash');
    process.exit(1);
}

const rpcUrl = process.env.SEPOLIA_API_URL!;
const analyzer = new TransactionAnalyzer(rpcUrl);
analyzer.analyze(txHash).catch(console.error);
