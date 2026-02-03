import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock instance that will be shared
const mockRedisInstance = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  zadd: vi.fn(),
  zcard: vi.fn(),
  zremrangebyscore: vi.fn(),
  expire: vi.fn(),
  ping: vi.fn(),
  quit: vi.fn(),
  on: vi.fn(),
};

// Mock ioredis with a proper class constructor
vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      get = mockRedisInstance.get;
      set = mockRedisInstance.set;
      del = mockRedisInstance.del;
      zadd = mockRedisInstance.zadd;
      zcard = mockRedisInstance.zcard;
      zremrangebyscore = mockRedisInstance.zremrangebyscore;
      expire = mockRedisInstance.expire;
      ping = mockRedisInstance.ping;
      quit = mockRedisInstance.quit;
      on = mockRedisInstance.on;
    },
  };
});

// Mock config
vi.mock('../config.js', () => ({
  config: {
    VALKEY_HOST: 'localhost',
    VALKEY_PORT: 6379,
    VALKEY_PASSWORD: undefined,
    STATE_TTL_SECONDS: 600,
    RATE_LIMIT_MAX_REQUESTS: 10,
    RATE_LIMIT_WINDOW_SECONDS: 60,
    LOG_LEVEL: 'info',
  },
}));

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ValkeyService', () => {
  let valkey: typeof import('../services/valkey.js').valkey;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Reset module cache and re-import
    vi.resetModules();
    const module = await import('../services/valkey.js');
    valkey = module.valkey;
  });

  describe('getState', () => {
    it('should return null when no state exists', async () => {
      mockRedisInstance.get.mockResolvedValue(null);

      const result = await valkey.getState('user123');

      expect(result).toBeNull();
      expect(mockRedisInstance.get).toHaveBeenCalledWith('bot:emoji:state:user123');
    });

    it('should return parsed state when it exists', async () => {
      const state = {
        status: 'confirming',
        fileId: 'file123',
        shortcode: 'test_emoji',
        replyToId: 'note123',
        originalText: 'test',
      };
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(state));

      const result = await valkey.getState('user123');

      expect(result).toEqual(state);
    });

    it('should return null and delete invalid JSON state', async () => {
      mockRedisInstance.get.mockResolvedValue('invalid json');

      const result = await valkey.getState('user123');

      expect(result).toBeNull();
      expect(mockRedisInstance.del).toHaveBeenCalled();
    });
  });

  describe('setState', () => {
    it('should save state with TTL', async () => {
      const state = {
        status: 'confirming' as const,
        fileId: 'file123',
        shortcode: 'test_emoji',
        replyToId: 'note123',
        originalText: 'test',
      };

      await valkey.setState('user123', state);

      expect(mockRedisInstance.set).toHaveBeenCalledWith(
        'bot:emoji:state:user123',
        JSON.stringify(state),
        'EX',
        600
      );
    });
  });

  describe('deleteState', () => {
    it('should delete state by key', async () => {
      await valkey.deleteState('user123');

      expect(mockRedisInstance.del).toHaveBeenCalledWith('bot:emoji:state:user123');
    });
  });

  describe('checkRateLimit', () => {
    it('should allow request when under limit', async () => {
      mockRedisInstance.zcard.mockResolvedValue(5);

      const result = await valkey.checkRateLimit('user123');

      expect(result).toBe(true);
      expect(mockRedisInstance.zadd).toHaveBeenCalled();
    });

    it('should deny request when at limit', async () => {
      mockRedisInstance.zcard.mockResolvedValue(10);

      const result = await valkey.checkRateLimit('user123');

      expect(result).toBe(false);
      expect(mockRedisInstance.zadd).not.toHaveBeenCalled();
    });

    it('should clean up old entries before checking', async () => {
      mockRedisInstance.zcard.mockResolvedValue(0);

      await valkey.checkRateLimit('user123');

      expect(mockRedisInstance.zremrangebyscore).toHaveBeenCalled();
    });
  });

  describe('ping', () => {
    it('should return true on successful ping', async () => {
      mockRedisInstance.ping.mockResolvedValue('PONG');

      const result = await valkey.ping();

      expect(result).toBe(true);
    });

    it('should return false on failed ping', async () => {
      mockRedisInstance.ping.mockRejectedValue(new Error('Connection failed'));

      const result = await valkey.ping();

      expect(result).toBe(false);
    });
  });
});
