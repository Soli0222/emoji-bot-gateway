import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchFontList, renderEmoji, clearFontCache } from '../services/renderer.js';
import type { EmojiParams } from '../services/llm.js';

// Mock config
vi.mock('../config.js', () => ({
  config: {
    RENDERER_BASE_URL: 'http://localhost:8080',
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

describe('Renderer Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFontCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchFontList', () => {
    it('should fetch and return font list', async () => {
      const mockFontsResponse = [
        { id: 'noto_sans_jp', name: 'Noto Sans JP', categories: ['sans-serif'] },
        { id: 'mplus_1p', name: 'M PLUS 1p', categories: ['sans-serif'] },
        { id: 'kosugi_maru', name: 'Kosugi Maru', categories: ['sans-serif'] },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockFontsResponse),
      });

      const result = await fetchFontList();

      expect(result).toEqual(['noto_sans_jp', 'mplus_1p', 'kosugi_maru']);
      expect(fetch).toHaveBeenCalledWith('http://localhost:8080/fonts');
    });

    it('should cache font list on subsequent calls', async () => {
      const mockFontsResponse = [
        { id: 'font_a', name: 'Font A', categories: ['sans-serif'] },
        { id: 'font_b', name: 'Font B', categories: ['sans-serif'] },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockFontsResponse),
      });

      await fetchFontList();
      await fetchFontList();
      await fetchFontList();

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw error on failed fetch', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(fetchFontList()).rejects.toThrow('Failed to fetch font list: 500');
    });
  });

  describe('renderEmoji', () => {
    it('should render emoji and return buffer', async () => {
      const params: EmojiParams = {
        text: 'テスト',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ffffff',
          outlineColor: '#000000',
          outlineWidth: 3,
          shadow: true,
        },
        layout: {
          mode: 'square',
          alignment: 'center',
        },
        motion: null,
        shortcode: 'test_emoji',
      };

      const mockImageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockImageData.buffer),
      });

      const result = await renderEmoji(params);

      expect(result).toBeInstanceOf(Buffer);
      expect(fetch).toHaveBeenCalledWith('http://localhost:8080/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'テスト',
          style: {
            fontId: 'notosansjp_black',
            textColor: '#ffffff',
            outlineColor: '#000000',
            outlineWidth: 3,
            shadow: true,
          },
          layout: {
            mode: 'square',
            alignment: 'center',
          },
        }),
      });
    });

    it('should render emoji with motion', async () => {
      const params: EmojiParams = {
        text: 'アニメ',
        style: {
          fontId: 'mplus1_black',
          textColor: '#ff0000',
          outlineColor: null,
          outlineWidth: null,
          shadow: null,
        },
        layout: null,
        motion: {
          type: 'shake',
          intensity: 'high',
        },
        shortcode: 'anime_emoji',
      };

      const mockImageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockImageData.buffer),
      });

      const result = await renderEmoji(params);

      expect(result).toBeInstanceOf(Buffer);
      expect(fetch).toHaveBeenCalledWith('http://localhost:8080/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'アニメ',
          style: {
            fontId: 'mplus1_black',
            textColor: '#ff0000',
          },
          motion: {
            type: 'shake',
            intensity: 'high',
          },
        }),
      });
    });

    it('should render minimal emoji (required fields only)', async () => {
      const params: EmojiParams = {
        text: 'シンプル',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#000000',
          outlineColor: null,
          outlineWidth: null,
          shadow: null,
        },
        layout: null,
        motion: null,
        shortcode: 'simple',
      };

      const mockImageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockImageData.buffer),
      });

      await renderEmoji(params);

      expect(fetch).toHaveBeenCalledWith('http://localhost:8080/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'シンプル',
          style: {
            fontId: 'notosansjp_black',
            textColor: '#000000',
          },
        }),
      });
    });

    it('should throw error on failed render', async () => {
      const params: EmojiParams = {
        text: 'テスト',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ffffff',
          outlineColor: null,
          outlineWidth: null,
          shadow: null,
        },
        layout: null,
        motion: null,
        shortcode: 'test_emoji',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Invalid parameters'),
      });

      await expect(renderEmoji(params)).rejects.toThrow('Failed to render emoji: 400');
    });
  });
});
