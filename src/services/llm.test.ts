import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmojiParamsSchema } from '../services/llm.js';

// Mock parse function - must be declared before vi.mock
const mockParse = vi.fn();

// Mock config
vi.mock('../config.js', () => ({
  config: {
    OPENAI_API_KEY: 'test-api-key',
    OPENAI_MODEL: 'gpt-5-mini-2025-08-07',
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

// Mock OpenAI - use a getter to reference the hoisted mockParse
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      responses = {
        get parse() {
          return mockParse;
        },
      };
    },
  };
});

// Mock zodTextFormat helper
vi.mock('openai/helpers/zod', () => ({
  zodTextFormat: vi.fn((schema, name) => ({
    type: 'json_schema',
    json_schema: { name },
  })),
}));

describe('LLM Service', () => {
  describe('EmojiParamsSchema', () => {
    it('should validate correct emoji params', () => {
      const validParams = {
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
        motion: {
          type: 'shake',
          intensity: 'medium',
        },
        shortcode: 'test_emoji',
        isSensitive: false,
      };

      const result = EmojiParamsSchema.safeParse(validParams);
      expect(result.success).toBe(true);
    });

    it('should validate minimal params (only required fields)', () => {
      const minimalParams = {
        text: 'OK',
        style: {
          fontId: 'mplus1_black',
          textColor: '#ff0000',
          outlineColor: null,
          outlineWidth: null,
          shadow: null,
        },
        layout: null,
        motion: null,
        shortcode: 'ok_emoji',
        isSensitive: false,
      };

      const result = EmojiParamsSchema.safeParse(minimalParams);
      expect(result.success).toBe(true);
    });

    it('should reject params without text', () => {
      const invalidParams = {
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ffffff',
        },
        shortcode: 'test',
        isSensitive: false,
      };

      const result = EmojiParamsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should reject params without style', () => {
      const invalidParams = {
        text: 'テスト',
        shortcode: 'test',
        isSensitive: false,
      };

      const result = EmojiParamsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should reject params without shortcode', () => {
      const invalidParams = {
        text: 'テスト',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ffffff',
        },
        isSensitive: false,
      };

      const result = EmojiParamsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should reject params without isSensitive', () => {
      const invalidParams = {
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
        shortcode: 'test',
      };

      const result = EmojiParamsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should accept nullable motion settings', () => {
      const params = {
        text: 'テスト',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ff0000',
          outlineColor: null,
          outlineWidth: null,
          shadow: null,
        },
        layout: null,
        motion: {
          type: 'bounce',
          intensity: 'high',
        },
        shortcode: 'test',
        isSensitive: false,
      };

      const result = EmojiParamsSchema.safeParse(params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.motion?.type).toBe('bounce');
      }
    });

    it('should accept nullable layout settings', () => {
      const params = {
        text: 'テスト',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ff0000',
          outlineColor: null,
          outlineWidth: null,
          shadow: null,
        },
        layout: {
          mode: 'banner',
          alignment: 'left',
        },
        motion: null,
        shortcode: 'test',
        isSensitive: false,
      };

      const result = EmojiParamsSchema.safeParse(params);
      expect(result.success).toBe(true);
    });

    it('should reject invalid motion type', () => {
      const params = {
        text: 'テスト',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ff0000',
        },
        motion: {
          type: 'invalid_motion',
        },
        shortcode: 'test',
        isSensitive: false,
      };

      const result = EmojiParamsSchema.safeParse(params);
      expect(result.success).toBe(false);
    });

    it('should reject outlineWidth outside valid range', () => {
      const params = {
        text: 'テスト',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ff0000',
          outlineWidth: 25, // max is 20
        },
        shortcode: 'test',
        isSensitive: false,
      };

      const result = EmojiParamsSchema.safeParse(params);
      expect(result.success).toBe(false);
    });
  });

  describe('generateEmojiParams', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should generate emoji params from user message', async () => {
      const mockResult = {
        text: 'やったー',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ff0000',
        },
        shortcode: 'yatta',
        isSensitive: false,
      };

      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: JSON.stringify(mockResult) }],
          },
        ],
        output_parsed: mockResult,
      });

      vi.resetModules();
      const { generateEmojiParams } = await import('../services/llm.js');

      const result = await generateEmojiParams('嬉しい絵文字作って', ['notosansjp_black', 'mplus1_black']);

      expect(result.params).toEqual({
        ...mockResult,
        layout: {
          mode: 'banner',
          alignment: null,
        },
        motion: null,
      });
      expect(result.explanation).toContain('やったー');
      expect(result.explanation).toContain('notosansjp_black');
      expect(mockParse).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-5-mini-2025-08-07',
          input: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user', content: '嬉しい絵文字作って' }),
          ]),
        })
      );
    });

    it('should include font list in system prompt', async () => {
      const mockResult = {
        text: 'テスト',
        style: {
          fontId: 'font_a',
          textColor: '#000000',
        },
        shortcode: 'test',
        isSensitive: false,
      };

      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: JSON.stringify(mockResult) }],
          },
        ],
        output_parsed: mockResult,
      });

      vi.resetModules();
      const { generateEmojiParams } = await import('../services/llm.js');

      await generateEmojiParams('テスト', ['Font A', 'Font B', 'Font C']);

      const callArgs = mockParse.mock.calls[0][0];
      const systemMessage = callArgs.input.find((m: { role: string }) => m.role === 'system');
      expect(systemMessage.content).toContain('Font A');
      expect(systemMessage.content).toContain('Font B');
      expect(systemMessage.content).toContain('Font C');
    });

    it('should instruct the model to avoid motion unless explicitly requested', async () => {
      const mockResult = {
        text: 'テスト',
        style: {
          fontId: 'font_a',
          textColor: '#000000',
        },
        shortcode: 'test',
        isSensitive: false,
      };

      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: JSON.stringify(mockResult) }],
          },
        ],
        output_parsed: mockResult,
      });

      vi.resetModules();
      const { generateEmojiParams } = await import('../services/llm.js');

      await generateEmojiParams('テスト', ['Font A']);

      const callArgs = mockParse.mock.calls[0][0];
      const systemMessage = callArgs.input.find((m: { role: string }) => m.role === 'system');
      expect(systemMessage.content).toContain('Default to a static emoji');
      expect(systemMessage.content).toContain('Only use motion effects when the user explicitly asks');
    });

    it('should instruct the model how to choose square vs banner mode', async () => {
      const mockResult = {
        text: 'テスト',
        style: {
          fontId: 'font_a',
          textColor: '#000000',
        },
        shortcode: 'test',
        isSensitive: false,
      };

      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: JSON.stringify(mockResult) }],
          },
        ],
        output_parsed: mockResult,
      });

      vi.resetModules();
      const { generateEmojiParams } = await import('../services/llm.js');

      await generateEmojiParams('テスト', ['Font A']);

      const callArgs = mockParse.mock.calls[0][0];
      const systemMessage = callArgs.input.find((m: { role: string }) => m.role === 'system');
      expect(systemMessage.content).toContain('Use square mode when each line is about 2 characters or less');
      expect(systemMessage.content).toContain('Otherwise use banner mode');
    });

    it('should instruct the model to mark sensitive emojis', async () => {
      const mockResult = {
        text: 'テスト',
        style: {
          fontId: 'font_a',
          textColor: '#000000',
        },
        shortcode: 'test',
        isSensitive: false,
      };

      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: JSON.stringify(mockResult) }],
          },
        ],
        output_parsed: mockResult,
      });

      vi.resetModules();
      const { generateEmojiParams } = await import('../services/llm.js');

      await generateEmojiParams('テスト', ['Font A']);

      const callArgs = mockParse.mock.calls[0][0];
      const systemMessage = callArgs.input.find((m: { role: string }) => m.role === 'system');
      expect(systemMessage.content).toContain('Mark isSensitive as true');
      expect(systemMessage.content).toContain('sexual, violent, discriminatory');
    });

    it('should force square mode for short text', async () => {
      const mockResult = {
        text: 'OK',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ff0000',
        },
        layout: {
          mode: 'banner',
          alignment: 'right',
        },
        shortcode: 'ok',
        isSensitive: false,
      };

      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: JSON.stringify(mockResult) }],
          },
        ],
        output_parsed: mockResult,
      });

      vi.resetModules();
      const { generateEmojiParams } = await import('../services/llm.js');

      const result = await generateEmojiParams('短い絵文字作って', ['notosansjp_black']);

      expect(result.params.layout).toEqual({
        mode: 'square',
        alignment: 'right',
      });
    });

    it('should force banner mode for longer text', async () => {
      const mockResult = {
        text: 'やったー',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ff0000',
        },
        layout: {
          mode: 'square',
          alignment: 'center',
        },
        shortcode: 'yatta',
        isSensitive: false,
      };

      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: JSON.stringify(mockResult) }],
          },
        ],
        output_parsed: mockResult,
      });

      vi.resetModules();
      const { generateEmojiParams } = await import('../services/llm.js');

      const result = await generateEmojiParams('嬉しい絵文字作って', ['notosansjp_black']);

      expect(result.params.layout).toEqual({
        mode: 'banner',
        alignment: 'center',
      });
    });

    it('should use square mode when every line is 2 characters or less', async () => {
      const mockResult = {
        text: 'わー\nいえ',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ff0000',
        },
        layout: null,
        shortcode: 'multi_line',
        isSensitive: false,
      };

      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: JSON.stringify(mockResult) }],
          },
        ],
        output_parsed: mockResult,
      });

      vi.resetModules();
      const { generateEmojiParams } = await import('../services/llm.js');

      const result = await generateEmojiParams('2行の短い絵文字作って', ['notosansjp_black']);

      expect(result.params.layout).toEqual({
        mode: 'square',
        alignment: null,
      });
    });

    it('should strip motion when the user did not explicitly request animation', async () => {
      const mockResult = {
        text: 'やったー',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ff0000',
        },
        motion: {
          type: 'bounce',
          intensity: 'high',
        },
        shortcode: 'yatta',
        isSensitive: false,
      };

      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: JSON.stringify(mockResult) }],
          },
        ],
        output_parsed: mockResult,
      });

      vi.resetModules();
      const { generateEmojiParams } = await import('../services/llm.js');

      const result = await generateEmojiParams('嬉しい絵文字作って', ['notosansjp_black']);

      expect(result.params.motion).toBeNull();
      expect(result.explanation).not.toContain('アニメーション');
    });

    it('should keep motion when the user explicitly requests animation', async () => {
      const mockResult = {
        text: 'やったー',
        style: {
          fontId: 'notosansjp_black',
          textColor: '#ff0000',
        },
        motion: {
          type: 'bounce',
          intensity: 'high',
        },
        shortcode: 'yatta',
        isSensitive: false,
      };

      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: JSON.stringify(mockResult) }],
          },
        ],
        output_parsed: mockResult,
      });

      vi.resetModules();
      const { generateEmojiParams } = await import('../services/llm.js');

      const result = await generateEmojiParams('動く嬉しい絵文字作って', ['notosansjp_black']);

      expect(result.params.motion).toEqual({
        type: 'bounce',
        intensity: 'high',
      });
      expect(result.explanation).toContain('bounceアニメーション');
    });

    it('should throw error when output_parsed is null', async () => {
      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: '' }],
          },
        ],
        output_parsed: null,
      });

      vi.resetModules();
      const { generateEmojiParams } = await import('../services/llm.js');

      await expect(generateEmojiParams('テスト', ['Font A'])).rejects.toThrow(
        'Failed to generate emoji parameters'
      );
    });

    it('should throw error when LLM refuses the request', async () => {
      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'refusal', refusal: 'I cannot help with that request' }],
          },
        ],
        output_parsed: null,
      });

      vi.resetModules();
      const { generateEmojiParams } = await import('../services/llm.js');

      await expect(generateEmojiParams('テスト', ['Font A'])).rejects.toThrow(
        'Failed to generate emoji parameters: request refused'
      );
    });
  });

  describe('classifyUserIntent', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should classify confirmation intent with fixed system prompt and user payload', async () => {
      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: '{"intent":"retake"}' }],
          },
        ],
        output_parsed: { intent: 'retake' },
      });

      vi.resetModules();
      const { classifyUserIntent } = await import('../services/llm.js');

      const result = await classifyUserIntent('色を赤にして', {
        originalText: 'かわいい絵文字を作って',
        shortcode: 'kawaii',
      });

      expect(result).toEqual({ intent: 'retake' });

      const callArgs = mockParse.mock.calls[0][0];
      expect(callArgs).toEqual(
        expect.objectContaining({
          model: 'gpt-5-mini-2025-08-07',
          max_output_tokens: 100,
        })
      );

      expect(callArgs.input[0]).toEqual({
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: expect.stringContaining('yes / cancel / retake / other'),
          },
        ],
      });
      expect(callArgs.input[1]).toEqual({
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '元のリクエスト: かわいい絵文字を作って\nショートコード: :kawaii:\nユーザー返信: 色を赤にして',
          },
        ],
      });
    });

    it('should throw error when intent classification is missing', async () => {
      mockParse.mockResolvedValue({
        output: [
          {
            type: 'message',
            content: [{ type: 'text', text: '' }],
          },
        ],
        output_parsed: null,
      });

      vi.resetModules();
      const { classifyUserIntent } = await import('../services/llm.js');

      await expect(
        classifyUserIntent('キャンセルでお願いします', {
          originalText: '絵文字を作って',
          shortcode: 'test',
        })
      ).rejects.toThrow('Failed to classify user intent');
    });
  });
});
