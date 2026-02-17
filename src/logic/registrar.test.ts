import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeUserResponse, handleConfirmation, extractNewRequest } from '../logic/registrar.js';
import type { ConversationState } from '../services/valkey.js';

// Use vi.hoisted to ensure mocks are available before vi.mock hoisting
const { mockDeleteState, mockAddEmoji, mockCreateNote, mockGenerateAndPropose } = vi.hoisted(() => ({
  mockDeleteState: vi.fn(),
  mockAddEmoji: vi.fn(),
  mockCreateNote: vi.fn(),
  mockGenerateAndPropose: vi.fn(),
}));

// Mock dependencies
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/valkey.js', () => ({
  valkey: {
    getState: vi.fn(),
    setState: vi.fn(),
    deleteState: mockDeleteState,
    checkRateLimit: vi.fn(),
  },
}));

vi.mock('../services/misskey.js', () => ({
  addEmoji: mockAddEmoji,
  createNote: mockCreateNote,
}));

vi.mock('./generator.js', () => ({
  generateAndPropose: mockGenerateAndPropose,
}));

describe('analyzeUserResponse', () => {
  describe('positive responses', () => {
    const positiveInputs = [
      'はい',
      'yes',
      'ok',
      'OK',
      'おk',
      'おけ',
      'お願い',
      '登録して',
      'いいよ',
      'いいね',
      'それで',
      '頼む',
      'よろしく',
      '👍',
      '⭕',
      '✅',
      '🙆',
    ];

    it.each(positiveInputs)('should detect "%s" as yes', (input) => {
      expect(analyzeUserResponse(input)).toBe('yes');
    });

    it('should detect positive response with whitespace', () => {
      expect(analyzeUserResponse('  はい  ')).toBe('yes');
    });

    it('should detect positive response case-insensitively', () => {
      expect(analyzeUserResponse('YES')).toBe('yes');
      expect(analyzeUserResponse('Ok')).toBe('yes');
    });
  });

  describe('negative responses', () => {
    const negativeInputs = [
      'いいえ',
      'no',
      'NO',
      'ダメ',
      'だめ',
      'やめて',
      'キャンセル',
      'cancel',
      '違う',
      'ちがう',
      '却下',
      '👎',
      '❌',
      '🙅',
      '✖',
    ];

    it.each(negativeInputs)('should detect "%s" as no', (input) => {
      expect(analyzeUserResponse(input)).toBe('no');
    });

    it('should detect negative response with whitespace', () => {
      expect(analyzeUserResponse('  いいえ  ')).toBe('no');
    });
  });

  describe('unknown responses', () => {
    const unknownInputs = [
      'ありがとう',
      'こんにちは',
      '何これ',
      'もう一度説明して',
      '',
      '...',
      '🤔',
    ];

    it.each(unknownInputs)('should detect "%s" as unknown', (input) => {
      expect(analyzeUserResponse(input)).toBe('unknown');
    });
  });

  describe('edge cases', () => {
    it('should handle mixed content starting with positive keyword', () => {
      expect(analyzeUserResponse('はい、お願いします')).toBe('yes');
    });

    it('should handle mixed content starting with negative keyword', () => {
      expect(analyzeUserResponse('いいえ、やめて')).toBe('no');
    });

    it('should return unknown for ambiguous messages', () => {
      // "いい" alone is not a match (needs いいよ or いいね)
      expect(analyzeUserResponse('いい感じ')).toBe('unknown');
    });
  });
});

describe('extractNewRequest', () => {
  it('should return null for simple rejection words', () => {
    expect(extractNewRequest('いいえ')).toBeNull();
    expect(extractNewRequest('no')).toBeNull();
    expect(extractNewRequest('ダメ')).toBeNull();
    expect(extractNewRequest('だめ')).toBeNull();
    expect(extractNewRequest('やめて')).toBeNull();
    expect(extractNewRequest('キャンセル')).toBeNull();
    expect(extractNewRequest('cancel')).toBeNull();
    expect(extractNewRequest('却下')).toBeNull();
    expect(extractNewRequest('違う')).toBeNull();
    expect(extractNewRequest('ちがう')).toBeNull();
  });

  it('should extract new request after rejection keyword and separator', () => {
    expect(extractNewRequest('いいえ、もっと可愛い絵文字にして')).toBe('もっと可愛い絵文字にして');
    expect(extractNewRequest('ダメ、赤色にして')).toBe('赤色にして');
    expect(extractNewRequest('違う もっと派手にして')).toBe('もっと派手にして');
    expect(extractNewRequest('no, make it bigger')).toBe('make it bigger');
  });

  it('should return null for rejection with only punctuation/separators', () => {
    expect(extractNewRequest('いいえ、')).toBeNull();
    expect(extractNewRequest('no...')).toBeNull();
  });
});

describe('handleConfirmation', () => {
  const mockState: ConversationState = {
    status: 'confirming',
    fileId: 'file123',
    shortcode: 'test_emoji',
    replyToId: 'note123',
    originalText: 'テスト絵文字作って',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when user says yes', () => {
    it('should register emoji and send success message', async () => {
      mockAddEmoji.mockResolvedValue(undefined);
      mockCreateNote.mockResolvedValue({ createdNote: { id: 'newNote123' } });

      await handleConfirmation('user123', 'はい', 'replyNote123', mockState);

      expect(mockAddEmoji).toHaveBeenCalledWith({
        name: 'test_emoji',
        fileId: 'file123',
      });
      expect(mockDeleteState).toHaveBeenCalledWith('user123');
      expect(mockCreateNote).toHaveBeenCalledWith({
        text: expect.stringContaining(':test_emoji:'),
        replyId: 'replyNote123',
      });
    });

    it('should handle emoji registration error', async () => {
      mockAddEmoji.mockRejectedValue(new Error('Duplicate shortcode'));
      mockCreateNote.mockResolvedValue({ createdNote: { id: 'newNote123' } });

      await handleConfirmation('user123', 'はい', 'replyNote123', mockState);

      expect(mockCreateNote).toHaveBeenCalledWith({
        text: expect.stringContaining('エラーが発生しました'),
        replyId: 'replyNote123',
      });
      expect(mockDeleteState).toHaveBeenCalledWith('user123');
    });
  });

  describe('when user says no', () => {
    it('should clear state and send acknowledgment', async () => {
      mockCreateNote.mockResolvedValue({ createdNote: { id: 'newNote123' } });

      await handleConfirmation('user123', 'いいえ', 'replyNote123', mockState);

      expect(mockDeleteState).toHaveBeenCalledWith('user123');
      expect(mockCreateNote).toHaveBeenCalledWith({
        text: expect.stringContaining('キャンセルしますね'),
        replyId: 'replyNote123',
      });
    });

    it('should trigger regeneration if message contains new request, with rejection prefix stripped', async () => {
      mockCreateNote.mockResolvedValue({ createdNote: { id: 'newNote123' } });
      mockGenerateAndPropose.mockResolvedValue({ success: true });

      await handleConfirmation('user123', 'いいえ、もっと可愛い絵文字にして', 'replyNote123', mockState);

      expect(mockDeleteState).toHaveBeenCalledWith('user123');
      expect(mockGenerateAndPropose).toHaveBeenCalledWith(
        'user123',
        'もっと可愛い絵文字にして',
        'replyNote123'
      );
    });

    it('should not trigger regeneration for short rejection', async () => {
      mockCreateNote.mockResolvedValue({ createdNote: { id: 'newNote123' } });

      await handleConfirmation('user123', 'no', 'replyNote123', mockState);

      expect(mockGenerateAndPropose).not.toHaveBeenCalled();
    });
  });

  describe('when user response is unknown', () => {
    it('should send guidance message', async () => {
      mockCreateNote.mockResolvedValue({ createdNote: { id: 'newNote123' } });

      await handleConfirmation('user123', 'わからない', 'replyNote123', mockState);

      expect(mockCreateNote).toHaveBeenCalledWith({
        text: expect.stringContaining('「はい」または「いいえ」'),
        replyId: 'replyNote123',
      });
      expect(mockDeleteState).not.toHaveBeenCalled();
    });
  });
});
