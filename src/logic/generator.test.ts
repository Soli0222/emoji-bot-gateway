import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EmojiParams } from '../services/llm.js';

// Mock all dependencies
vi.mock('../config.js', () => ({
  config: {
    RENDERER_BASE_URL: 'http://localhost:8080',
    STATE_TTL_SECONDS: 600,
    LOG_LEVEL: 'info',
  },
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockValkey = {
  getState: vi.fn(),
  setState: vi.fn(),
  deleteState: vi.fn(),
  checkRateLimit: vi.fn(),
};

vi.mock('../services/valkey.js', () => ({
  valkey: mockValkey,
}));

const mockLlm = {
  generateEmojiParams: vi.fn(),
};

vi.mock('../services/llm.js', () => ({
  generateEmojiParams: mockLlm.generateEmojiParams,
  EmojiParamsSchema: {},
}));

const mockRenderer = {
  fetchFontList: vi.fn(),
  renderEmoji: vi.fn(),
};

vi.mock('../services/renderer.js', () => ({
  fetchFontList: mockRenderer.fetchFontList,
  renderEmoji: mockRenderer.renderEmoji,
}));

const mockMisskey = {
  uploadFile: vi.fn(),
  createNote: vi.fn(),
};

vi.mock('../services/misskey.js', () => ({
  uploadFile: mockMisskey.uploadFile,
  createNote: mockMisskey.createNote,
}));

describe('Generator Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateAndPropose', () => {
    it('should complete full generation flow', async () => {
      // Setup mocks
      mockRenderer.fetchFontList.mockResolvedValue(['notosansjp_black', 'mplus1_black']);
      mockLlm.generateEmojiParams.mockResolvedValue({
        params: {
          text: 'テスト',
          style: {
            fontId: 'notosansjp_black',
            textColor: '#ffffff',
          },
          shortcode: 'test_emoji',
        } as EmojiParams,
        explanation: 'テスト絵文字',
      });
      mockRenderer.renderEmoji.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      mockMisskey.uploadFile.mockResolvedValue({ id: 'file123', url: 'https://example.com/file.png' });
      mockMisskey.createNote.mockResolvedValue({ createdNote: { id: 'note456' } });

      // Import after mocks are set up
      const { generateAndPropose } = await import('../logic/generator.js');

      const result = await generateAndPropose('user123', '絵文字作って', 'replyNote123');

      expect(result.success).toBe(true);
      expect(result.fileId).toBe('file123');
      expect(result.shortcode).toBe('test_emoji');

      expect(mockRenderer.fetchFontList).toHaveBeenCalled();
      expect(mockLlm.generateEmojiParams).toHaveBeenCalledWith('絵文字作って', ['notosansjp_black', 'mplus1_black']);
      expect(mockRenderer.renderEmoji).toHaveBeenCalled();
      expect(mockMisskey.uploadFile).toHaveBeenCalled();
      expect(mockValkey.setState).toHaveBeenCalledWith('user123', expect.objectContaining({
        status: 'confirming',
        fileId: 'file123',
        shortcode: 'test_emoji',
      }));
      expect(mockMisskey.createNote).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockRenderer.fetchFontList.mockRejectedValue(new Error('Service unavailable'));

      const { generateAndPropose } = await import('../logic/generator.js');

      const result = await generateAndPropose('user123', '絵文字作って', 'replyNote123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Service unavailable');
      expect(mockMisskey.createNote).toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringContaining('エラーが発生しました'),
      }));
    });
  });
});
