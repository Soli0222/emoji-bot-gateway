import { config } from '../config.js';
import { logger } from '../logger.js';
import type { EmojiParams } from './llm.js';

interface FontInfo {
  id: string;
  name: string;
  categories: string[];
}

let fontListCache: string[] | null = null;

export async function fetchFontList(): Promise<string[]> {
  if (fontListCache) {
    return fontListCache;
  }

  const response = await fetch(`${config.RENDERER_BASE_URL}/fonts`);

  if (!response.ok) {
    throw new Error(`Failed to fetch font list: ${response.status}`);
  }

  const data = (await response.json()) as FontInfo[];
  fontListCache = data.map((font) => font.id);
  logger.info({ fontCount: fontListCache.length }, 'Fetched font list from renderer');

  return fontListCache;
}

export async function renderEmoji(params: EmojiParams): Promise<Buffer> {
  // Build the request body matching the renderer API spec
  const requestBody: Record<string, unknown> = {
    text: params.text,
    style: {
      fontId: params.style.fontId,
      textColor: params.style.textColor,
      ...(params.style.outlineColor && { outlineColor: params.style.outlineColor }),
      ...(params.style.outlineWidth && { outlineWidth: params.style.outlineWidth }),
      ...(params.style.shadow != null && { shadow: params.style.shadow }),
    },
  };

  if (params.layout) {
    requestBody.layout = {
      ...(params.layout.mode && { mode: params.layout.mode }),
      ...(params.layout.alignment && { alignment: params.layout.alignment }),
    };
  }

  if (params.motion?.type && params.motion.type !== 'none') {
    requestBody.motion = {
      type: params.motion.type,
      ...(params.motion.intensity && { intensity: params.motion.intensity }),
    };
  }

  const response = await fetch(`${config.RENDERER_BASE_URL}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, err: errorText }, 'Render failed');
    throw new Error(`Failed to render emoji: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function clearFontCache(): void {
  fontListCache = null;
}
