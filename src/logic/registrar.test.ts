import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeUserResponse, handleConfirmation } from '../logic/registrar.js';
import type { ConversationState } from '../services/valkey.js';

const {
  mockCompareAndDeleteState,
  mockCompareAndSetState,
  mockSetState,
  mockDeleteState,
  mockCheckRateLimit,
  mockAddEmoji,
  mockCreateNote,
  mockGenerateAndPropose,
  mockClassifyUserIntent,
} = vi.hoisted(() => ({
  mockCompareAndDeleteState: vi.fn(),
  mockCompareAndSetState: vi.fn(),
  mockSetState: vi.fn(),
  mockDeleteState: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockAddEmoji: vi.fn(),
  mockCreateNote: vi.fn(),
  mockGenerateAndPropose: vi.fn(),
  mockClassifyUserIntent: vi.fn(),
}));

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
    setState: mockSetState,
    deleteState: mockDeleteState,
    checkRateLimit: mockCheckRateLimit,
    compareAndSetState: mockCompareAndSetState,
    compareAndDeleteState: mockCompareAndDeleteState,
  },
}));

vi.mock('../services/misskey.js', () => ({
  addEmoji: mockAddEmoji,
  createNote: mockCreateNote,
}));

vi.mock('../services/llm.js', () => ({
  classifyUserIntent: mockClassifyUserIntent,
}));

vi.mock('./generator.js', () => ({
  generateAndPropose: mockGenerateAndPropose,
}));

describe('analyzeUserResponse', () => {
  it.each(['はい', 'はい！', 'yes', 'OK', 'お願い', '登録して', '👍', '✅'])(
    'detects "%s" as yes',
    (input) => {
      expect(analyzeUserResponse(input)).toBe('yes');
    }
  );

  it.each(['いいえ', 'NO', 'キャンセル', 'cancel', 'やめます', '❌', '🙅'])(
    'detects "%s" as cancel',
    (input) => {
      expect(analyzeUserResponse(input)).toBe('cancel');
    }
  );

  it.each([
    'ありがとう',
    'いいえ、もっと可愛く',
    'やり直し',
    '作り直して',
    '色を赤にして',
    '',
  ])('detects "%s" as unknown', (input) => {
    expect(analyzeUserResponse(input)).toBe('unknown');
  });
});

describe('handleConfirmation', () => {
  const confirmingState: ConversationState = {
    status: 'confirming',
    fileId: 'file123',
    shortcode: 'test_emoji',
    isSensitive: false,
    replyToId: 'note123',
    originalText: 'テスト絵文字作って',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCompareAndDeleteState.mockResolvedValue(true);
    mockCompareAndSetState.mockResolvedValue(true);
    mockCheckRateLimit.mockResolvedValue(true);
    mockAddEmoji.mockResolvedValue(undefined);
    mockCreateNote.mockResolvedValue({ createdNote: { id: 'newNote123' } });
    mockGenerateAndPropose.mockResolvedValue({ success: true });
    mockClassifyUserIntent.mockResolvedValue({ intent: 'other' });
    mockSetState.mockResolvedValue(undefined);
    mockDeleteState.mockResolvedValue(undefined);
  });

  it('blocks replies while retaking', async () => {
    await handleConfirmation('user123', 'はい', 'replyNote123', {
      ...confirmingState,
      status: 'retaking',
    });

    expect(mockCreateNote).toHaveBeenCalledWith({
      text: '再生成中です。少々お待ちください…',
      replyId: 'replyNote123',
    });
    expect(mockClassifyUserIntent).not.toHaveBeenCalled();
  });

  it('registers emoji only after consuming the confirming state', async () => {
    await handleConfirmation('user123', 'はい', 'replyNote123', confirmingState);

    expect(mockCompareAndDeleteState).toHaveBeenCalledWith('user123', {
      status: 'confirming',
      replyToId: 'note123',
      fileId: 'file123',
    });
    expect(mockAddEmoji).toHaveBeenCalledWith({
      name: 'test_emoji',
      fileId: 'file123',
      localOnly: false,
    });
    expect(mockCreateNote).toHaveBeenCalledWith({
      text: ':test_emoji: を登録しました。',
      replyId: 'replyNote123',
    });
  });

  it('does not register when the confirmation is stale', async () => {
    mockCompareAndDeleteState.mockResolvedValue(false);

    await handleConfirmation('user123', 'はい', 'replyNote123', confirmingState);

    expect(mockAddEmoji).not.toHaveBeenCalled();
    expect(mockCreateNote).toHaveBeenCalledWith({
      text: 'この確認はすでに処理済みです。最新の案内を確認してください。',
      replyId: 'replyNote123',
    });
  });

  it('reports registration errors after the state is consumed', async () => {
    mockAddEmoji.mockRejectedValue(new Error('Duplicate shortcode'));

    await handleConfirmation('user123', 'はい', 'replyNote123', confirmingState);

    expect(mockCreateNote).toHaveBeenCalledWith({
      text: expect.stringContaining('エラーが発生しました'),
      replyId: 'replyNote123',
    });
    expect(mockDeleteState).not.toHaveBeenCalled();
  });

  it('registers sensitive emoji as local-only', async () => {
    await handleConfirmation('user123', 'はい', 'replyNote123', {
      ...confirmingState,
      isSensitive: true,
    });

    expect(mockAddEmoji).toHaveBeenCalledWith({
      name: 'test_emoji',
      fileId: 'file123',
      localOnly: true,
    });
  });

  it('cancels after consuming the confirming state', async () => {
    await handleConfirmation('user123', 'いいえ', 'replyNote123', confirmingState);

    expect(mockCompareAndDeleteState).toHaveBeenCalledWith('user123', {
      status: 'confirming',
      replyToId: 'note123',
      fileId: 'file123',
    });
    expect(mockCreateNote).toHaveBeenCalledWith({
      text: '承知しました。今回はキャンセルします。',
      replyId: 'replyNote123',
    });
  });

  it('classifies natural-language cancellation through the LLM path', async () => {
    mockClassifyUserIntent.mockResolvedValue({ intent: 'cancel' });

    await handleConfirmation(
      'user123',
      'キャンセルでお願いします',
      'replyNote123',
      confirmingState
    );

    expect(mockClassifyUserIntent).toHaveBeenCalledWith('キャンセルでお願いします', {
      originalText: 'テスト絵文字作って',
      shortcode: 'test_emoji',
    });
    expect(mockCreateNote).toHaveBeenCalledWith({
      text: '承知しました。今回はキャンセルします。',
      replyId: 'replyNote123',
    });
  });

  it('returns guidance when the LLM classifies the reply as other', async () => {
    mockClassifyUserIntent.mockResolvedValue({ intent: 'other' });

    await handleConfirmation('user123', '今日の天気は？', 'replyNote123', confirmingState);

    expect(mockCreateNote).toHaveBeenCalledWith({
      text: '登録する場合は「はい」、キャンセルは「いいえ」、修正したい場合はそのまま要望を送ってください。',
      replyId: 'replyNote123',
    });
    expect(mockCompareAndDeleteState).not.toHaveBeenCalled();
  });

  it('falls back to guidance if LLM classification fails', async () => {
    mockClassifyUserIntent.mockRejectedValue(new Error('LLM unavailable'));

    await handleConfirmation('user123', 'おっけー', 'replyNote123', confirmingState);

    expect(mockCreateNote).toHaveBeenCalledWith({
      text: '登録する場合は「はい」、キャンセルは「いいえ」、修正したい場合はそのまま要望を送ってください。',
      replyId: 'replyNote123',
    });
  });

  it('transitions to retaking and re-generates on retake intent', async () => {
    mockClassifyUserIntent.mockResolvedValue({ intent: 'retake' });

    await handleConfirmation('user123', '色を赤にして', 'replyNote123', confirmingState);

    expect(mockCheckRateLimit).toHaveBeenCalledWith('user123');
    expect(mockCompareAndSetState).toHaveBeenCalledWith(
      'user123',
      {
        status: 'confirming',
        replyToId: 'note123',
        fileId: 'file123',
      },
      {
        ...confirmingState,
        status: 'retaking',
      }
    );
    expect(mockGenerateAndPropose).toHaveBeenCalledWith(
      'user123',
      'テスト絵文字作って\n\n修正依頼: 色を赤にして',
      'replyNote123'
    );
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it('restores the previous confirming state when retake generation returns failure', async () => {
    mockClassifyUserIntent.mockResolvedValue({ intent: 'retake' });
    mockGenerateAndPropose.mockResolvedValue({ success: false });

    await handleConfirmation('user123', 'もっと丸くして', 'replyNote123', confirmingState);

    expect(mockSetState).toHaveBeenCalledWith('user123', {
      ...confirmingState,
      status: 'confirming',
    });
  });

  it('deletes the conversation state if rollback after retake also fails', async () => {
    mockClassifyUserIntent.mockResolvedValue({ intent: 'retake' });
    mockGenerateAndPropose.mockRejectedValue(new Error('render failed'));
    mockSetState.mockRejectedValue(new Error('restore failed'));

    await expect(
      handleConfirmation('user123', 'もっと丸くして', 'replyNote123', confirmingState)
    ).rejects.toThrow('render failed');

    expect(mockDeleteState).toHaveBeenCalledWith('user123');
  });

  it('does not retake when the user is rate-limited', async () => {
    mockClassifyUserIntent.mockResolvedValue({ intent: 'retake' });
    mockCheckRateLimit.mockResolvedValue(false);

    await handleConfirmation('user123', 'やり直し', 'replyNote123', confirmingState);

    expect(mockCompareAndSetState).not.toHaveBeenCalled();
    expect(mockGenerateAndPropose).not.toHaveBeenCalled();
    expect(mockCreateNote).toHaveBeenCalledWith({
      text: 'リクエストが多すぎます。少し時間をおいてからお試しください。',
      replyId: 'replyNote123',
    });
  });

  it('treats failed CAS during retake as stale state', async () => {
    mockClassifyUserIntent.mockResolvedValue({ intent: 'retake' });
    mockCompareAndSetState.mockResolvedValue(false);

    await handleConfirmation('user123', 'やり直し', 'replyNote123', confirmingState);

    expect(mockGenerateAndPropose).not.toHaveBeenCalled();
    expect(mockCreateNote).toHaveBeenCalledWith({
      text: 'この確認はすでに処理済みです。最新の案内を確認してください。',
      replyId: 'replyNote123',
    });
  });
});
