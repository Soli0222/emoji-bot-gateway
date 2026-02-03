import type { Note } from 'misskey-js/entities.js';
import { logger } from '../logger.js';

/**
 * Check if the user is a local user (not from another instance)
 */
export function isLocalUser(note: Note): boolean {
  // host is null for local users
  return note.user.host === null;
}

/**
 * Extract the actual message content, removing mention prefix
 */
export function extractMessageContent(text: string | null, botUsername: string): string {
  if (!text) return '';

  // Remove the bot mention from the beginning
  const mentionPattern = new RegExp(`^@${botUsername}\\s*`, 'i');
  return text.replace(mentionPattern, '').trim();
}

/**
 * Filter function for incoming mentions
 * Returns true if the mention should be processed
 */
export function shouldProcessMention(note: Note): boolean {
  // Must be from a local user
  if (!isLocalUser(note)) {
    logger.debug({ userId: note.userId, host: note.user.host }, 'Ignored remote user');
    return false;
  }

  // Must have text content
  if (!note.text) {
    logger.debug({ noteId: note.id }, 'Ignored note without text');
    return false;
  }

  // Ignore notes from bots to prevent infinite loops
  if (note.user.isBot) {
    logger.debug({ userId: note.userId }, 'Ignored bot user');
    return false;
  }

  return true;
}
