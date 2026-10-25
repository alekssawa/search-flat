import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const config = {
  botToken: process.env.BOT_TOKEN || '',
  targetChatId: process.env.TARGET_CHAT_ID ? Number(process.env.TARGET_CHAT_ID) : 0,
  pollIntervalMinutes: Number(process.env.POLL_INTERVAL_MINUTES) || 15,
  initialSkipExisting: process.env.INITIAL_SKIP_EXISTING !== 'false',
  accessToken: process.env.ACCESS_TOKEN || '',
  authHeader: process.env.AUTH_HEADER || '',
  dbPath: path.resolve(process.cwd(), 'flats.db'),
};

export function validateBotConfig(): void {
  if (!config.botToken) {
    throw new Error('BOT_TOKEN is not defined in .env file!');
  }
  if (!config.targetChatId) {
    throw new Error('TARGET_CHAT_ID is not defined in .env file!');
  }
}
