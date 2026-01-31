import { formatUnits, parseUnits } from 'ethers';
import { Token } from '../src/pricing/Token';
import { UniswapV2Pair } from '../src/pricing/UniswapV2Pair';
import { Address } from '../src/core/types/Address';
import { PriceImpactAnalyzer } from '../src/pricing/PriceImpactAnalyzer';
import Table from 'cli-table3';
import chalk from 'chalk';

async function main() {
    const args = process.argv.slice(2);
    const pairAddressStr = args[0];

    if (!pairAddressStr) {
        console.log(chalk.red('Error: Pair address is required.'));
        console.log(
            chalk.yellow('Usage: ts-node cli.ts <PAIR_ADDRESS> --token-in USDC --sizes 1000,5000'),
        );
        process.exit(1);
    }
    const getArg = (flag: string, def: string) => {
        const idx = args.indexOf(flag);
        return idx > -1 && args[idx + 1] ? args[idx + 1] : def;
    };

    const tokenInSymbol = getArg('--token-in', 'USDC');
    const sizesStr = getArg('--sizes', '1000,10000,100000,1000000');

    try {
        const ETH = new Token('ETH', 18, new Address('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'));
        const USDC = new Token(
            'USDC',
            6,
            new Address('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
        );
        const pairAddress = new Address(pairAddressStr);

        const reserveETH = parseUnits('1000', 18);
        const reserveUSDC = parseUnits('2000000', 6);

        const pair = new UniswapV2Pair(pairAddress, USDC, ETH, reserveUSDC, reserveETH);
        const analyzer = new PriceImpactAnalyzer(pair);

        const isInputUSDC = tokenInSymbol.toUpperCase() === 'USDC';
        const tokenIn = isInputUSDC ? USDC : ETH;
        const tokenOut = isInputUSDC ? ETH : USDC;

        const inputSizes = sizesStr
            .split(/[, ]+/)
            .filter((s) => s)
            .map((s) => parseUnits(s, tokenIn.decimals));

        console.log(
            '\n' + chalk.bold(`Price Impact Analysis for ${tokenIn.name} -> ${tokenOut.name}`),
        );
        console.log(`Pool: ${chalk.cyan(pairAddress.checksum)}`);

        const r0 = Number(formatUnits(pair.reserve0, pair.token0.decimals)).toLocaleString();
        const r1 = Number(formatUnits(pair.reserve1, pair.token1.decimals)).toLocaleString();
        console.log(`Reserves: ${r0} ${pair.token0.name} / ${r1} ${pair.token1.name}`);

        const spot = pair.getSpotPrice(tokenIn);
        const spotFmt = formatUnits(spot, 18);
        console.log(
            `Spot Price: ${chalk.green(Number(spotFmt).toLocaleString())} ${tokenOut.name} per ${tokenIn.name}\n`,
        );

        const table = new Table({
            head: [
                chalk.white(`${tokenIn.name} In`),
                chalk.white(`${tokenOut.name} Out`),
                chalk.white('Exec Price'),
                chalk.white('Impact'),
            ],
            colAligns: ['right', 'right', 'right', 'right'],
            style: { head: [], border: [] },
        });

        const impacts = analyzer.generateImpactTable(tokenIn, inputSizes);

        impacts.forEach((row) => {
            const amtIn = Number(formatUnits(row.amountIn, tokenIn.decimals)).toLocaleString();

            const amtOut = Number(formatUnits(row.amountOut, tokenOut.decimals)).toLocaleString(
                undefined,
                { maximumFractionDigits: 6 },
            );

            const amountInNum = Number(formatUnits(row.amountIn, tokenIn.decimals));
            const amountOutNum = Number(formatUnits(row.amountOut, tokenOut.decimals));

            const displayExecPrice = amountInNum / amountOutNum;

            const execPrice = displayExecPrice.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });

            const impactNum = Number(formatUnits(row.priceImpactPct, 18));

            let impactStr = `${impactNum.toFixed(2)}%`;

            if (impactNum > 5) impactStr = chalk.red(impactStr);
            else if (impactNum > 1) impactStr = chalk.yellow(impactStr);
            else impactStr = chalk.green(impactStr);

            table.push([amtIn, amtOut, execPrice, impactStr]);
        });

        console.log(table.toString());
        const maxTrade = analyzer.findMaxSizeForImpact(tokenIn, 1n);

        const maxTradeFmt = Number(formatUnits(maxTrade, tokenIn.decimals)).toLocaleString();
        console.log(
            `\nMax trade for ${chalk.yellow('1% impact')}: ${chalk.bold(maxTradeFmt)} ${tokenIn.name}\n`,
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
        console.error(chalk.red('Error:'), e.message);
    }
}

main();
