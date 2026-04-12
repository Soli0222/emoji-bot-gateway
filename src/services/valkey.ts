import Redis from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';

const KEY_PREFIX = 'bot:emoji:';

export interface ConversationState {
  status: 'confirming' | 'retaking';
  fileId: string;
  shortcode: string;
  replyToId: string;
  originalText: string;
}

export interface ConfirmingStateMatcher {
  status: 'confirming';
  replyToId: string;
  fileId: string;
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

  async compareAndSetState(
    userId: string,
    expected: ConfirmingStateMatcher,
    newState: ConversationState
  ): Promise<boolean> {
    const key = this.stateKey(userId);
    const luaScript = `
      local current = redis.call('GET', KEYS[1])
      if not current then return 0 end

      local parsed = cjson.decode(current)
      if parsed.status ~= ARGV[1] then return 0 end
      if parsed.replyToId ~= ARGV[2] then return 0 end
      if parsed.fileId ~= ARGV[3] then return 0 end

      redis.call('SET', KEYS[1], ARGV[4], 'EX', ARGV[5])
      return 1
    `;

    const result = await this.client.eval(
      luaScript,
      1,
      key,
      expected.status,
      expected.replyToId,
      expected.fileId,
      JSON.stringify(newState),
      config.STATE_TTL_SECONDS
    );

    return result === 1;
  }

  async compareAndDeleteState(
    userId: string,
    expected: ConfirmingStateMatcher
  ): Promise<boolean> {
    const key = this.stateKey(userId);
    const luaScript = `
      local current = redis.call('GET', KEYS[1])
      if not current then return 0 end

      local parsed = cjson.decode(current)
      if parsed.status ~= ARGV[1] then return 0 end
      if parsed.replyToId ~= ARGV[2] then return 0 end
      if parsed.fileId ~= ARGV[3] then return 0 end

      redis.call('DEL', KEYS[1])
      return 1
    `;

    const result = await this.client.eval(
      luaScript,
      1,
      key,
      expected.status,
      expected.replyToId,
      expected.fileId
    );

    return result === 1;
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
