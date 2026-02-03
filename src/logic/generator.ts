import { generateEmojiParams, type EmojiParams } from '../services/llm.js';
import { fetchFontList, renderEmoji } from '../services/renderer.js';
import { uploadFile, createNote } from '../services/misskey.js';
import { valkey, type ConversationState } from '../services/valkey.js';
import { logger } from '../logger.js';

export interface GenerationResult {
  success: boolean;
  fileId?: string;
  shortcode?: string;
  error?: string;
}

/**
 * Phase 2: Generate emoji and send proposal to user
 */
export async function generateAndPropose(
  userId: string,
  userMessage: string,
  replyToNoteId: string
): Promise<GenerationResult> {
  try {
    // Step 1: Get font list
    const fontList = await fetchFontList();

    // Step 2: Generate emoji parameters with AI
    logger.info({ userId, message: userMessage }, 'Generating emoji params');
    const { params } = await generateEmojiParams(userMessage, fontList);

    // Step 3: Render the emoji
    logger.info({ params }, 'Rendering emoji');
    const imageBuffer = await renderEmoji(params);

    // Step 4: Upload to Misskey Drive
    const uploadResult = await uploadFile(imageBuffer, params.shortcode);

    // Step 5: Save state to Valkey
    const state: ConversationState = {
      status: 'confirming',
      fileId: uploadResult.id,
      shortcode: params.shortcode,
      replyToId: replyToNoteId,
      originalText: userMessage,
    };
    await valkey.setState(userId, state);

    // Step 6: Send proposal reply
    await createNote({
      text: buildProposalMessage(params),
      replyId: replyToNoteId,
      fileIds: [uploadResult.id],
    });

    logger.info({ userId, shortcode: params.shortcode }, 'Proposal sent');

    return {
      success: true,
      fileId: uploadResult.id,
      shortcode: params.shortcode,
    };
  } catch (error) {
    logger.error({ err: error, userId }, 'Generation failed');

    // Send error message to user
    await createNote({
      text: '申し訳ありません、絵文字の生成中にエラーが発生しました。もう一度お試しください。',
      replyId: replyToNoteId,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function buildProposalMessage(params: EmojiParams): string {
  const motionDesc = params.motion?.type && params.motion.type !== 'none' 
    ? `\n🎬 アニメーション: ${params.motion.type}` 
    : '';
  
  return `絵文字を作成しました！

📝 テキスト: ${params.text}
🔤 フォント: ${params.style.fontId}
🎨 色: ${params.style.textColor}${motionDesc}
🏷️ ショートコード: \`:${params.shortcode}:\`

この絵文字を登録しますか？（はい/いいえ）`;
}
