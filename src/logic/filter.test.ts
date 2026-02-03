import { describe, it, expect, vi } from 'vitest';
import type { Note } from 'misskey-js/entities.js';
import {
  isLocalUser,
  extractMessageContent,
  shouldProcessMention,
} from '../logic/filter.js';

// Mock logger to avoid import issues
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createMockNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note123',
    createdAt: new Date().toISOString(),
    userId: 'user123',
    user: {
      id: 'user123',
      username: 'testuser',
      host: null,
      name: 'Test User',
      isBot: false,
      avatarUrl: null,
      avatarBlurhash: null,
      emojis: {},
      onlineStatus: 'online',
      badgeRoles: [],
    },
    text: '@emojibot 絵文字作って',
    cw: null,
    visibility: 'public',
    localOnly: false,
    reactionAcceptance: null,
    reactions: {},
    reactionEmojis: {},
    renoteCount: 0,
    repliesCount: 0,
    fileIds: [],
    files: [],
    replyId: null,
    renoteId: null,
    ...overrides,
  } as Note;
}

describe('isLocalUser', () => {
  it('should return true for local users (host is null)', () => {
    const note = createMockNote({
      user: {
        ...createMockNote().user,
        host: null,
      },
    });

    expect(isLocalUser(note)).toBe(true);
  });

  it('should return false for remote users (host is not null)', () => {
    const note = createMockNote({
      user: {
        ...createMockNote().user,
        host: 'remote.instance.com',
      },
    });

    expect(isLocalUser(note)).toBe(false);
  });
});

describe('extractMessageContent', () => {
  it('should remove bot mention from the beginning', () => {
    const result = extractMessageContent('@emojibot 絵文字作って', 'emojibot');
    expect(result).toBe('絵文字作って');
  });

  it('should handle multiple spaces after mention', () => {
    const result = extractMessageContent('@emojibot    テスト', 'emojibot');
    expect(result).toBe('テスト');
  });

  it('should return empty string for null text', () => {
    const result = extractMessageContent(null, 'emojibot');
    expect(result).toBe('');
  });

  it('should handle text without mention', () => {
    const result = extractMessageContent('普通のテキスト', 'emojibot');
    expect(result).toBe('普通のテキスト');
  });

  it('should be case-insensitive for mention', () => {
    const result = extractMessageContent('@EmojiBot テスト', 'emojibot');
    expect(result).toBe('テスト');
  });
});

describe('shouldProcessMention', () => {
  it('should return true for valid local user mention', () => {
    const note = createMockNote();
    expect(shouldProcessMention(note)).toBe(true);
  });

  it('should return false for remote users', () => {
    const note = createMockNote({
      user: {
        ...createMockNote().user,
        host: 'remote.example.com',
      },
    });
    expect(shouldProcessMention(note)).toBe(false);
  });

  it('should return false for notes without text', () => {
    const note = createMockNote({ text: null });
    expect(shouldProcessMention(note)).toBe(false);
  });

  it('should return false for bot users', () => {
    const note = createMockNote({
      user: {
        ...createMockNote().user,
        isBot: true,
      },
    });
    expect(shouldProcessMention(note)).toBe(false);
  });

  it('should return false for empty text', () => {
    const note = createMockNote({ text: '' });
    expect(shouldProcessMention(note)).toBe(false);
  });
});
