import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config
vi.mock('../config.js', () => ({
  config: {
    MISSKEY_HOST: 'misskey.example.com',
    MISSKEY_TOKEN: 'test-token',
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

// Mock misskey-js
const mockRequest = vi.fn();
vi.mock('misskey-js', () => ({
  api: {
    APIClient: class MockAPIClient {
      request = mockRequest;
    },
  },
  Stream: class MockStream {
    useChannel = vi.fn(() => ({
      on: vi.fn(),
    }));
    on = vi.fn();
  },
}));

describe('Misskey Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('uploadFile', () => {
    it('should upload file and return result', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ id: 'file123', url: 'https://example.com/file.png' }),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const { uploadFile } = await import('../services/misskey.js');
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      
      const result = await uploadFile(buffer, 'test_emoji');

      expect(result).toEqual({ id: 'file123', url: 'https://example.com/file.png' });
      expect(fetch).toHaveBeenCalledWith(
        'https://misskey.example.com/api/drive/files/create',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should throw error on failed upload', async () => {
      const mockResponse = {
        ok: false,
        status: 413,
        text: () => Promise.resolve('File too large'),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const { uploadFile } = await import('../services/misskey.js');
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      await expect(uploadFile(buffer, 'test_emoji')).rejects.toThrow('Failed to upload file: 413');
    });
  });

  describe('createNote', () => {
    it('should create note with text only', async () => {
      mockRequest.mockResolvedValue({ createdNote: { id: 'note123' } });

      vi.resetModules();
      const { createNote } = await import('../services/misskey.js');

      const result = await createNote({ text: 'テストメッセージ' });

      expect(result).toEqual({ createdNote: { id: 'note123' } });
      expect(mockRequest).toHaveBeenCalledWith('notes/create', {
        text: 'テストメッセージ',
        replyId: undefined,
        fileIds: undefined,
        visibility: 'home',
      });
    });

    it('should create note with reply and files', async () => {
      mockRequest.mockResolvedValue({ createdNote: { id: 'note456' } });

      vi.resetModules();
      const { createNote } = await import('../services/misskey.js');

      const result = await createNote({
        text: '返信です',
        replyId: 'originalNote123',
        fileIds: ['file1', 'file2'],
        visibility: 'public',
      });

      expect(result).toEqual({ createdNote: { id: 'note456' } });
      expect(mockRequest).toHaveBeenCalledWith('notes/create', {
        text: '返信です',
        replyId: 'originalNote123',
        fileIds: ['file1', 'file2'],
        visibility: 'public',
      });
    });
  });

  describe('addEmoji', () => {
    it('should register emoji', async () => {
      mockRequest.mockResolvedValue({});

      vi.resetModules();
      const { addEmoji } = await import('../services/misskey.js');

      await addEmoji({
        name: 'test_emoji',
        fileId: 'file123',
        category: 'custom',
      });

      expect(mockRequest).toHaveBeenCalledWith('admin/emoji/add', {
        name: 'test_emoji',
        fileId: 'file123',
        category: 'custom',
        aliases: [],
        isSensitive: false,
        localOnly: false,
      });
    });

    it('should register emoji without category', async () => {
      mockRequest.mockResolvedValue({});

      vi.resetModules();
      const { addEmoji } = await import('../services/misskey.js');

      await addEmoji({
        name: 'simple_emoji',
        fileId: 'file456',
      });

      expect(mockRequest).toHaveBeenCalledWith('admin/emoji/add', {
        name: 'simple_emoji',
        fileId: 'file456',
        category: undefined,
        aliases: [],
        isSensitive: false,
        localOnly: false,
      });
    });
  });

  describe('getStreamingClient', () => {
    it('should return a Stream instance', async () => {
      vi.resetModules();
      const { getStreamingClient } = await import('../services/misskey.js');

      const client = getStreamingClient();

      expect(client).toBeDefined();
      expect(client.useChannel).toBeDefined();
    });
  });
});
