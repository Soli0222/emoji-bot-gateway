import { generateEmojiParams, type EmojiParams } from '../services/llm.js';
import { fetchFontList, renderEmoji } from '../services/renderer.js';
import { uploadFile, createNote, isShortcodeTaken } from '../services/misskey.js';
import { valkey, type ConversationState } from '../services/valkey.js';
import { logger } from '../logger.js';

export interface GenerationResult {
  success: boolean;
  fileId?: string;
  shortcode?: string;
  error?: string;
}

const SHORTCODE_SUFFIX_RETRY_LIMIT = 5;
const RANDOM_SUFFIX_RETRY_LIMIT = 5;
const RANDOM_SUFFIX_LENGTH = 4;

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

    // Step 2.5: Resolve shortcode collisions before rendering and upload
    const shortcode = await resolveAvailableShortcode(params.shortcode);
    const resolvedParams =
      shortcode === params.shortcode ? params : { ...params, shortcode };

    // Step 3: Render the emoji
    logger.info({ params: resolvedParams }, 'Rendering emoji');
    const imageBuffer = await renderEmoji(resolvedParams);

    // Step 4: Upload to Misskey Drive
    const uploadResult = await uploadFile(imageBuffer, resolvedParams.shortcode);

    // Step 5: Save state to Valkey
    const state: ConversationState = {
      status: 'confirming',
      fileId: uploadResult.id,
      shortcode: resolvedParams.shortcode,
      isSensitive: resolvedParams.isSensitive,
      replyToId: replyToNoteId,
      originalText: userMessage,
    };
    await valkey.setState(userId, state);

    // Step 6: Send proposal reply
    await createNote({
      text: buildProposalMessage(resolvedParams),
      replyId: replyToNoteId,
      fileIds: [uploadResult.id],
    });

    logger.info({ userId, shortcode: resolvedParams.shortcode }, 'Proposal sent');

    return {
      success: true,
      fileId: uploadResult.id,
      shortcode: resolvedParams.shortcode,
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

async function resolveAvailableShortcode(baseShortcode: string): Promise<string> {
  if (!(await isShortcodeTaken(baseShortcode))) {
    return baseShortcode;
  }

  for (let suffix = 2; suffix <= SHORTCODE_SUFFIX_RETRY_LIMIT + 1; suffix += 1) {
    const candidate = `${baseShortcode}_${suffix}`;
    if (!(await isShortcodeTaken(candidate))) {
      logger.info({ original: baseShortcode, resolved: candidate }, 'Resolved duplicate shortcode');
      return candidate;
    }
  }

  for (let attempt = 0; attempt < RANDOM_SUFFIX_RETRY_LIMIT; attempt += 1) {
    const candidate = `${baseShortcode}_${generateRandomSuffix(RANDOM_SUFFIX_LENGTH)}`;
    if (!(await isShortcodeTaken(candidate))) {
      logger.info({ original: baseShortcode, resolved: candidate }, 'Resolved duplicate shortcode');
      return candidate;
    }
  }

  throw new Error(`Failed to find available shortcode for ${baseShortcode}`);
}

function generateRandomSuffix(length: number): string {
  const max = 36 ** length;
  return Math.floor(Math.random() * max)
    .toString(36)
    .padStart(length, '0');
}

function buildProposalMessage(params: EmojiParams): string {
  const motionDesc = params.motion?.type && params.motion.type !== 'none'
    ? `\n🎬 アニメーション: ${params.motion.type}`
    : '';
  const sensitiveNotice = params.isSensitive
    ? '\n⚠ この絵文字はセンシティブと判定されたため、ローカル限定で登録されます。'
    : '';

  return `絵文字を作成しました！

📝 テキスト: ${params.text}
🔤 フォント: ${params.style.fontId}
🎨 色: ${params.style.textColor}${motionDesc}
🏷️ ショートコード: \`:${params.shortcode}:\`${sensitiveNotice}

この絵文字を登録しますか？
登録は「はい」、キャンセルは「いいえ」、
修正したい場合はそのまま要望を送ってください。`;
}
