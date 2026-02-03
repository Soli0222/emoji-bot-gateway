import * as Misskey from 'misskey-js';
import { config } from '../config.js';
import { logger } from '../logger.js';

const client = new Misskey.api.APIClient({
  origin: `https://${config.MISSKEY_HOST}`,
  credential: config.MISSKEY_TOKEN,
});

export interface UploadResult {
  id: string;
  url: string;
}

export async function uploadFile(
  buffer: Buffer,
  name: string
): Promise<UploadResult> {
  // Convert Buffer to Uint8Array with explicit ArrayBuffer type for Blob compatibility
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  const uint8Array = new Uint8Array(arrayBuffer);
  const blob = new Blob([uint8Array], { type: 'image/png' });
  const formData = new FormData();
  formData.append('file', blob, `${name}.png`);
  formData.append('i', config.MISSKEY_TOKEN);

  const response = await fetch(`https://${config.MISSKEY_HOST}/api/drive/files/create`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'File upload failed');
    throw new Error(`Failed to upload file: ${response.status}`);
  }

  const result = (await response.json()) as { id: string; url: string };
  logger.info({ fileId: result.id }, 'File uploaded to Misskey Drive');

  return { id: result.id, url: result.url };
}

export async function createNote(params: {
  text: string;
  replyId?: string;
  fileIds?: string[];
  visibility?: 'public' | 'home' | 'followers' | 'specified';
}): Promise<{ createdNote: { id: string } }> {
  const response = await client.request('notes/create', {
    text: params.text,
    replyId: params.replyId,
    fileIds: params.fileIds,
    visibility: params.visibility ?? 'home',
  });

  logger.debug({ noteId: response.createdNote.id }, 'Note created');
  return response;
}

export async function addEmoji(params: {
  name: string;
  fileId: string;
  category?: string;
}): Promise<void> {
  await client.request('admin/emoji/add', {
    name: params.name,
    fileId: params.fileId,
    category: params.category,
    aliases: [],
    isSensitive: false,
    localOnly: false,
  });

  logger.info({ name: params.name }, 'Emoji registered');
}

export function getStreamingClient() {
  return new Misskey.Stream(`https://${config.MISSKEY_HOST}`, {
    token: config.MISSKEY_TOKEN,
  });
}

export { client as misskeyClient };
