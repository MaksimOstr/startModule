// DO NOT MODIFY THESE VALUES
export const absoluteMaxTradeUsd = 25.0;
export const absoluteMaxDailyLoss = 20.0;
export const absoluteMinCapital = 50.0;
export const absoluteMaxTradesPerHour = 30;

export type SafetyCheckResult = [boolean, string];

export const safetyCheck = (
    tradeUsd: number,
    dailyLoss: number,
    totalCapital: number,
    tradesThisHour: number,
): SafetyCheckResult => {
    // Final safety gate: runs AFTER all other checks.
    if (tradeUsd > absoluteMaxTradeUsd) {
        return [false, `Trade ${tradeUsd.toFixed(0)} exceeds absolute max`];
    }
    if (dailyLoss <= -absoluteMaxDailyLoss) {
        return [false, 'Absolute daily loss limit reached'];
    }
    if (totalCapital < absoluteMinCapital) {
        return [false, `Capital ${totalCapital.toFixed(0)} below minimum`];
    }
    if (tradesThisHour >= absoluteMaxTradesPerHour) {
        return [false, 'Absolute hourly trade limit reached'];
    }

    return [true, 'OK'];
};
