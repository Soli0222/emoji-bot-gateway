import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// Schema for emoji generation parameters matching the renderer API
// Note: OpenAI Structured Outputs requires .nullable() instead of .optional()
export const EmojiParamsSchema = z.object({
  text: z.string().describe('The text to render on the emoji (max 20 chars, use \\n for newlines)'),
  layout: z
    .object({
      mode: z.enum(['square', 'banner']).nullable().describe('square: 256x256 fixed, banner: height 256, width variable'),
      alignment: z.enum(['left', 'center', 'right']).nullable().describe('Text alignment'),
    })
    .nullable(),
  style: z.object({
    fontId: z.string().describe('Font ID from the available list'),
    textColor: z.string().describe('Text color in hex format (e.g., #FF0000)'),
    outlineColor: z.string().nullable().describe('Outline color in hex format'),
    outlineWidth: z.number().int().min(0).max(20).nullable().describe('Outline width in pixels (0-20)'),
    shadow: z.boolean().nullable().describe('Enable drop shadow'),
  }),
  motion: z
    .object({
      type: z.enum(['none', 'shake', 'spin', 'bounce', 'gaming']).nullable().describe('Animation type'),
      intensity: z.enum(['low', 'medium', 'high']).nullable().describe('Animation intensity'),
    })
    .nullable(),
  shortcode: z.string().describe('Suggested shortcode for the emoji (lowercase alphanumeric and underscores only)'),
});

export type EmojiParams = z.infer<typeof EmojiParamsSchema>;

export interface LLMResult {
  params: EmojiParams;
  explanation: string;
}

export async function generateEmojiParams(
  userMessage: string,
  fontList: string[]
): Promise<LLMResult> {
  const systemPrompt = `You are an emoji design assistant for Misskey. Your task is to analyze user requests and generate parameters for custom emoji creation.

Available font IDs:
${fontList.map((f) => `- ${f}`).join('\n')}

Guidelines:
1. Choose an appropriate fontId that matches the mood/style requested
2. Generate a creative shortcode using only lowercase letters, numbers, and underscores
3. Keep text concise for emoji display (ideally 1-4 characters or short words, max 20 chars)
4. Select colors that enhance readability and visual appeal (use hex format like #FF0000)
5. Consider the context and tone of the user's request
6. Use motion effects when appropriate (shake for excitement, spin for fun, bounce for playful, gaming for rainbow effect)
7. Add outline (outlineWidth > 0) for better readability on various backgrounds
8. Use \\n for multi-line text`;

  const response = await openai.responses.parse({
    model: config.OPENAI_MODEL,
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    text: {
      format: zodTextFormat(EmojiParamsSchema, 'emoji_params'),
    },
    max_output_tokens: 2000,
  });

  // Handle refusal
  if (response.output[0]?.type === 'message') {
    const message = response.output[0];
    if (message.content[0]?.type === 'refusal') {
      const refusal = message.content[0].refusal;
      logger.warn({ refusal }, 'LLM refused to generate emoji params');
      throw new Error('Failed to generate emoji parameters: request refused');
    }
  }

  const parsed = response.output_parsed;

  if (!parsed) {
    logger.error({ response }, 'Failed to get parsed output from LLM');
    throw new Error('Failed to generate emoji parameters');
  }

  const motionDesc = parsed.motion?.type && parsed.motion.type !== 'none' 
    ? `（${parsed.motion.type}アニメーション付き）` 
    : '';

  return {
    params: parsed,
    explanation: `テキスト「${parsed.text}」をフォント「${parsed.style.fontId}」で作成します${motionDesc}。`,
  };
}
