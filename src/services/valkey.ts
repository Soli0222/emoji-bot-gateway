import Redis from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';

const KEY_PREFIX = 'bot:emoji:';

export interface ConversationState {
  status: 'confirming';
  fileId: string;
  shortcode: string;
  replyToId: string;
  originalText: string;
}

class ValkeyService {
  private client: Redis;

  constructor() {
    this.client = new Redis({
      host: config.VALKEY_HOST,
      port: config.VALKEY_PORT,
      password: config.VALKEY_PASSWORD,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn({ times, delay }, 'Valkey connection retry');
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    this.client.on('connect', () => {
      logger.info('Connected to Valkey');
    });

    this.client.on('error', (err) => {
      logger.error({ err }, 'Valkey connection error');
    });
  }

  private stateKey(userId: string): string {
    return `${KEY_PREFIX}state:${userId}`;
  }

  private rateLimitKey(userId: string): string {
    return `${KEY_PREFIX}ratelimit:${userId}`;
  }

  async getState(userId: string): Promise<ConversationState | null> {
    const data = await this.client.get(this.stateKey(userId));
    if (!data) return null;

    try {
      return JSON.parse(data) as ConversationState;
    } catch {
      logger.warn({ userId }, 'Failed to parse state, clearing');
      await this.deleteState(userId);
      return null;
    }
  }

  async setState(userId: string, state: ConversationState): Promise<void> {
    await this.client.set(
      this.stateKey(userId),
      JSON.stringify(state),
      'EX',
      config.STATE_TTL_SECONDS
    );
  }

  async deleteState(userId: string): Promise<void> {
    await this.client.del(this.stateKey(userId));
  }

  /**
   * Token Bucket Rate Limiting
   * Returns true if the request is allowed, false if rate limited
   */
  async checkRateLimit(userId: string): Promise<boolean> {
    const key = this.rateLimitKey(userId);
    const now = Date.now();
    const windowMs = config.RATE_LIMIT_WINDOW_SECONDS * 1000;

    // Remove old entries
    await this.client.zremrangebyscore(key, 0, now - windowMs);

    // Count current requests in window
    const count = await this.client.zcard(key);

    if (count >= config.RATE_LIMIT_MAX_REQUESTS) {
      return false;
    }

    // Add current request
    await this.client.zadd(key, now, `${now}-${Math.random()}`);
    await this.client.expire(key, config.RATE_LIMIT_WINDOW_SECONDS);

    return true;
  }

  /**
   * Check if a note has already been processed (deduplication)
   * Returns true if this is the first time seeing this note, false if duplicate
   */
  async markNoteProcessed(noteId: string): Promise<boolean> {
    const key = `${KEY_PREFIX}processed:${noteId}`;
    // SET with NX returns 'OK' only if the key didn't exist
    const result = await this.client.set(key, '1', 'EX', 300, 'NX');
    return result === 'OK';
  }

  async close(): Promise<void> {
    await this.client.quit();
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}

export const valkey = new ValkeyService();
