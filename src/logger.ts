import { configDotenv } from 'dotenv';
import { createLogger, format, transports } from 'winston';

configDotenv({ quiet: true });

const isTruthy = (value: string | undefined): boolean => {
    if (!value) return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const isProduction = isTruthy(process.env.PRODUCTION) || process.env.NODE_ENV === 'production';
const useJsonLogs = isTruthy(process.env.LOG_JSON);

const LEVEL_COLORS: Record<string, string> = {
    error: '\x1b[31m',
    warn: '\x1b[33m',
    info: '\x1b[36m',
    http: '\x1b[35m',
    verbose: '\x1b[37m',
    debug: '\x1b[90m',
    silly: '\x1b[90m',
};
const COLOR_RESET = '\x1b[0m';

const devFormat = format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.printf((info) => {
        const { timestamp, level, message, stack, scope, ...meta } = info;
        delete meta.service;
        delete meta.env;
        const normalizedLevel = String(level).toLowerCase();
        const levelColor = LEVEL_COLORS[normalizedLevel] || '\x1b[37m';
        const levelLabel = `${levelColor}${normalizedLevel.toUpperCase()}${COLOR_RESET}`;
        const scopeLabel = scope ? ` [${scope}]` : '';
        const messageText = typeof message === 'string' ? message : JSON.stringify(message);
        const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';

        if (stack) {
            return `${timestamp} [${levelLabel}]${scopeLabel} ${messageText}${metaString}\n${stack}`;
        }
        return `${timestamp} [${levelLabel}]${scopeLabel} ${messageText}${metaString}`;
    }),
);

const prodFormat = format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json(),
);

export const logger = createLogger({
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    defaultMeta: useJsonLogs
        ? {
              service: process.env.SERVICE_NAME || 'startmodule',
              env: isProduction ? 'production' : 'development',
          }
        : {},
    format: useJsonLogs ? prodFormat : devFormat,
    transports: [new transports.Console()],
});

export const getLogger = (scope: string) => logger.child({ scope });
