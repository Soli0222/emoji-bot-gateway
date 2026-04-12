import { valkey, type ConversationState } from '../services/valkey.js';
import { addEmoji, createNote } from '../services/misskey.js';
import { classifyUserIntent } from '../services/llm.js';
import { generateAndPropose } from './generator.js';
import { logger } from '../logger.js';

export type UserIntent = 'yes' | 'cancel' | 'retake' | 'unknown';

const STALE_CONFIRMATION_MESSAGE =
  'この確認はすでに処理済みです。最新の案内を確認してください。';

/**
 * Analyze user's response to determine intent
 */
export function analyzeUserResponse(text: string): UserIntent {
  const normalizedText = text.toLowerCase().trim();

  const positivePatterns = [
    /^(はい|yes|ok|おk|おけ|お願い(します)?|登録(して)?|いいよ|いいね|それで|頼む|よろしく)[!！。]*$/,
    /👍|⭕|✅|🙆/,
  ];

  const cancelPatterns = [
    /^(いいえ|no|ダメ|だめ|やめ(ます)?|キャンセル|cancel|違う|ちがう|却下)[!！。]*$/,
    /👎|❌|🙅|✖/,
  ];

  for (const pattern of positivePatterns) {
    if (pattern.test(normalizedText)) {
      return 'yes';
    }
  }

  for (const pattern of cancelPatterns) {
    if (pattern.test(normalizedText)) {
      return 'cancel';
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
  if (state.status === 'retaking') {
    await createNote({
      text: '再生成中です。少々お待ちください…',
      replyId: replyToNoteId,
    });
    return;
  }

  let intent: UserIntent = analyzeUserResponse(userMessage);

  if (intent === 'unknown') {
    try {
      const result = await classifyUserIntent(userMessage, {
        originalText: state.originalText,
        shortcode: state.shortcode,
      });

      if (result.intent === 'other') {
        await handleUnknown(replyToNoteId);
        return;
      }

      intent = result.intent;
    } catch (error) {
      logger.error(
        { err: error, userId, userMessage },
        'Intent classification failed, falling back to guidance'
      );
      await handleUnknown(replyToNoteId);
      return;
    }
  }

  switch (intent) {
    case 'yes':
      await handleYes(userId, replyToNoteId, state);
      break;

    case 'cancel':
      await handleNo(userId, replyToNoteId, state);
      break;

    case 'retake':
      await handleRetake(userId, userMessage, replyToNoteId, state);
      break;
  }
}

async function handleYes(
  userId: string,
  replyToNoteId: string,
  state: ConversationState
): Promise<void> {
  try {
    const consumed = await valkey.compareAndDeleteState(userId, {
      status: 'confirming',
      replyToId: state.replyToId,
      fileId: state.fileId,
    });

    if (!consumed) {
      await createNote({
        text: STALE_CONFIRMATION_MESSAGE,
        replyId: replyToNoteId,
      });
      return;
    }

    await addEmoji({
      name: state.shortcode,
      fileId: state.fileId,
    });

    await createNote({
      text: `:${state.shortcode}: を登録しました。`,
      replyId: replyToNoteId,
    });

    logger.info({ userId, shortcode: state.shortcode }, 'Emoji registered successfully');
  } catch (error) {
    logger.error({ err: error, userId, state }, 'Failed to register emoji');

    await createNote({
      text: '絵文字の登録中にエラーが発生しました。ショートコードが既に使用されている可能性があります。',
      replyId: replyToNoteId,
    });
  }
}

async function handleNo(
  userId: string,
  replyToNoteId: string,
  state: ConversationState
): Promise<void> {
  const consumed = await valkey.compareAndDeleteState(userId, {
    status: 'confirming',
    replyToId: state.replyToId,
    fileId: state.fileId,
  });

  if (!consumed) {
    await createNote({
      text: STALE_CONFIRMATION_MESSAGE,
      replyId: replyToNoteId,
    });
    return;
  }

  await createNote({
    text: '承知しました。今回はキャンセルします。',
    replyId: replyToNoteId,
  });

  logger.info({ userId }, 'User rejected proposal, cleared state');
}

async function handleRetake(
  userId: string,
  userMessage: string,
  replyToNoteId: string,
  state: ConversationState
): Promise<void> {
  const allowed = await valkey.checkRateLimit(userId);
  if (!allowed) {
    await createNote({
      text: 'リクエストが多すぎます。少し時間をおいてからお試しください。',
      replyId: replyToNoteId,
    });
    return;
  }

  const transitioned = await valkey.compareAndSetState(
    userId,
    {
      status: 'confirming',
      replyToId: state.replyToId,
      fileId: state.fileId,
    },
    {
      ...state,
      status: 'retaking',
    }
  );

  if (!transitioned) {
    await createNote({
      text: STALE_CONFIRMATION_MESSAGE,
      replyId: replyToNoteId,
    });
    return;
  }

  let restorePreviousConfirming = true;

  try {
    const retakeMessage = `${state.originalText}\n\n修正依頼: ${userMessage}`;
    const result = await generateAndPropose(userId, retakeMessage, replyToNoteId);

    if (result.success) {
      restorePreviousConfirming = false;
    }
  } finally {
    if (!restorePreviousConfirming) {
      return;
    }

    try {
      await valkey.setState(userId, {
        ...state,
        status: 'confirming',
      });
    } catch (rollbackError) {
      logger.error(
        { err: rollbackError, userId },
        'Failed to restore confirming state after retake; deleting conversation state'
      );
      await valkey.deleteState(userId);
    }
  }
}

async function handleUnknown(replyToNoteId: string): Promise<void> {
  await createNote({
    text: '登録する場合は「はい」、キャンセルは「いいえ」、修正したい場合はそのまま要望を送ってください。',
    replyId: replyToNoteId,
  });
}
