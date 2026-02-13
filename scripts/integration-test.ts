import { ethers } from 'ethers';
import { WalletManager } from '../src/core/WalletManager';
import { ChainClient } from '../src/chain/ChainClient';
import { TransactionBuilder } from '../src/chain/TransactionBuilder';
import { Address } from '../src/core/types/Address';
import { TokenAmount } from '../src/core/types/TokenAmount';
import { Priority } from '../src/chain/types/GasPrice';

const walletManager = WalletManager.fromEnv();
const chainClient = new ChainClient([process.env.SEPOLIA_API_URL!]);

(async () => {
    const walletAddress = new Address(walletManager.address);

    console.log('================ INTEGRATION TEST =================');
    console.log('Wallet Address:       ', walletAddress.checksum);

    const balance = await chainClient.getBalance(walletAddress);
    console.log('Balance:              ', balance.toString());

    const nonce = await chainClient.getNonce(walletAddress);
    console.log('Transaction Nonce:    ', nonce);

    const txBuilder = await new TransactionBuilder(chainClient, walletManager)
        .to(walletAddress)
        .value(TokenAmount.fromHuman('0.0001', 18, 'ETH'))
        .nonce(nonce)
        .withGasEstimate()
        .then((builder) => builder.withGasPrice(Priority.MEDIUM));

    const tx = txBuilder.build();
    console.log('Estimated Gas Limit:  ', tx.gasLimit?.toString());
    console.log('Max Fee Per Gas:      ', tx.maxFeePerGas?.toString());
    console.log('Max Priority Fee:     ', tx.maxPriorityFee?.toString());

    const signedTx = await walletManager.signTransaction(tx);

    const parsedTransaction = ethers.Transaction.from(signedTx);
    const signerAddress = parsedTransaction.from;

    console.log('Recovered Signer:     ', signerAddress);
    console.log('Signature Valid:      ', signerAddress === walletAddress.checksum ? 'YES' : 'NO');

    console.log('---------------- Sending Transaction ----------------');
    const txHash = await chainClient.sendTransaction(signedTx);
    console.log('Transaction Hash:     ', txHash);

    const receipt = await chainClient.waitForReceipt(txHash);

    console.log('================ Transaction Receipt =================');
    console.log('Block Number:         ', receipt?.blockNumber);
    console.log('Gas Used:             ', receipt?.gasUsed.toString());
    console.log('Effective Gas Price:  ', receipt?.effectiveGasPrice.toString());
    console.log('Transaction Fee:      ', receipt?.txFee.toString());
    console.log('Logs Count:           ', receipt?.logs.length);
    console.log('=======================================================');
})();
