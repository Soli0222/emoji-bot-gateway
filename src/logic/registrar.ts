import { valkey, type ConversationState } from '../services/valkey.js';
import { addEmoji, createNote } from '../services/misskey.js';
import { generateAndPropose } from './generator.js';
import { logger } from '../logger.js';

export type UserIntent = 'yes' | 'no' | 'unknown';

/**
 * Analyze user's response to determine intent
 */
export function analyzeUserResponse(text: string): UserIntent {
  const normalizedText = text.toLowerCase().trim();

  // Positive responses
  const positivePatterns = [
    /^(はい|yes|ok|おk|おけ|お願い|登録|いいよ|いいね|それで|頼む|よろしく)/,
    /👍|⭕|✅|🙆/,
  ];

  // Negative responses
  const negativePatterns = [
    /^(いいえ|no|ダメ|だめ|やめ|キャンセル|cancel|作り直|やり直|違う|ちがう|却下)/,
    /👎|❌|🙅|✖/,
  ];

  for (const pattern of positivePatterns) {
    if (pattern.test(normalizedText)) {
      return 'yes';
    }
  }

  for (const pattern of negativePatterns) {
    if (pattern.test(normalizedText)) {
      return 'no';
    }
  }

  return 'unknown';
}

/**
 * Phase 3: Handle user confirmation response
 */
export async function handleConfirmation(
  userId: string,
  userMessage: string,
  replyToNoteId: string,
  state: ConversationState
): Promise<void> {
  const intent = analyzeUserResponse(userMessage);

  switch (intent) {
    case 'yes':
      await handleYes(userId, replyToNoteId, state);
      break;

    case 'no':
      await handleNo(userId, userMessage, replyToNoteId, state);
      break;

    case 'unknown':
      await handleUnknown(replyToNoteId);
      break;
  }
}

async function handleYes(
  userId: string,
  replyToNoteId: string,
  state: ConversationState
): Promise<void> {
  try {
    // Register the emoji
    await addEmoji({
      name: state.shortcode,
      fileId: state.fileId,
    });

    // Clear the state
    await valkey.deleteState(userId);

    // Send success message
    await createNote({
      text: `絵文字を登録しました！ :${state.shortcode}: でお使いいただけます！`,
      replyId: replyToNoteId,
    });

    logger.info({ userId, shortcode: state.shortcode }, 'Emoji registered successfully');
  } catch (error) {
    logger.error({ err: error, userId, state }, 'Failed to register emoji');

    await createNote({
      text: '絵文字の登録中にエラーが発生しました。ショートコードが既に使用されている可能性があります。',
      replyId: replyToNoteId,
    });

    // Clear state on error
    await valkey.deleteState(userId);
  }
}

async function handleNo(
  userId: string,
  userMessage: string,
  replyToNoteId: string,
  _state: ConversationState
): Promise<void> {
  // Clear the current state
  await valkey.deleteState(userId);

  // Send acknowledgment
  await createNote({
    text: '承知しました。キャンセルしますね。新しいリクエストをお待ちしています！',
    replyId: replyToNoteId,
  });

  logger.info({ userId }, 'User rejected proposal, cleared state');

  // If the message contains new instructions, trigger regeneration
  const hasNewRequest = userMessage.length > 10 && !/^(いいえ|no|ダメ|だめ|やめ|キャンセル)$/i.test(userMessage.trim());

  if (hasNewRequest) {
    // Re-enter Phase 2 with the new request
    await generateAndPropose(userId, userMessage, replyToNoteId);
  }
}

async function handleUnknown(replyToNoteId: string): Promise<void> {
  await createNote({
    text: '「はい」または「いいえ」でお答えください。登録する場合は「はい」、作り直す場合は「いいえ」と返信してください。',
    replyId: replyToNoteId,
  });
}
