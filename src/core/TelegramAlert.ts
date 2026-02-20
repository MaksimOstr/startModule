import { getLogger } from '../logger';

export class TelegramAlert {
    private readonly logger = getLogger('TelegramAlert');
    private readonly baseUrl: string;

    constructor(
        private readonly botToken: string,
        private readonly chatId: string,
    ) {
        if (!botToken) {
            throw new Error('Telegram botToken is required');
        }
        if (!chatId) {
            throw new Error('Telegram chatId is required');
        }
        this.baseUrl = `https://api.telegram.org/bot${botToken}`;
    }

    public async send(message: string, urgent: boolean = false): Promise<void> {
        if (urgent) {
            message = `🚨 URGENT 🚨\n${message}`;
        }

        const timeoutMs = 10_000;
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

        try {
            await fetch(`${this.baseUrl}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.chatId,
                    text: message,
                    parse_mode: 'HTML',
                }),
                signal: controller.signal,
            });
        } catch (error) {
            this.logger.error(
                `Telegram send failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            clearTimeout(timeoutHandle);
        }
    }
}
