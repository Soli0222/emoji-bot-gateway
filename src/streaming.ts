import type { Note } from 'misskey-js/entities.js';
import { getStreamingClient } from './services/misskey.js';
import { valkey } from './services/valkey.js';
import { shouldProcessMention, extractMessageContent } from './logic/filter.js';
import { generateAndPropose } from './logic/generator.js';
import { handleConfirmation, analyzeUserResponse } from './logic/registrar.js';
import { logger } from './logger.js';

// Bot username - will be set during initialization
let botUsername = '';
let streamingConnected = false;
let streamGeneration = 0;

const INITIAL_CONNECTION_TIMEOUT = 30_000;
const DISCONNECT_FATAL_TIMEOUT = 120_000;

/**
 * Handle incoming mention event
 */
async function handleMention(note: Note): Promise<void> {
  // Phase 1: Filtering
  if (!shouldProcessMention(note)) {
    return;
  }

  // Deduplication: Skip if we've already processed this note
  const isNew = await valkey.markNoteProcessed(note.id);
  if (!isNew) {
    logger.debug({ noteId: note.id }, 'Duplicate note detected, skipping');
    return;
  }

  const userId = note.userId;

  // Rate limit check
  const allowed = await valkey.checkRateLimit(userId);
  if (!allowed) {
    logger.warn({ userId }, 'Rate limited user');
    return;
  }

  // Extract message content
  const message = extractMessageContent(note.text, botUsername);
  if (!message) {
    logger.debug({ noteId: note.id }, 'Empty message after extraction');
    return;
  }

  logger.info({ userId, noteId: note.id, message }, 'Processing mention');

  try {
    // Check for existing conversation state
    const state = await valkey.getState(userId);

    if (state) {
      // Phase 3: Handle confirmation flow
      logger.debug({ userId, state }, 'Existing state found, handling confirmation');
      await handleConfirmation(userId, message, note.id, state);
    } else {
      // Guard: If the message looks like a confirmation response (yes/no)
      // but there's no active state, ignore it instead of generating an emoji
      const intent = analyzeUserResponse(message);
      if (intent !== 'unknown') {
        logger.debug({ userId, message, intent }, 'Confirmation response without active state, ignoring');
        return;
      }

      // Phase 2: New generation request
      logger.debug({ userId }, 'No state found, starting generation');
      await generateAndPropose(userId, message, note.id);
    }
  } catch (error) {
    logger.error({ err: error, userId, noteId: note.id }, 'Error handling mention');
  }
}

export function isStreamingConnected(): boolean {
  return streamingConnected;
}

/**
 * Start the streaming connection
 */
export async function startStreaming(): Promise<void> {
  logger.info('Connecting to Misskey Streaming API...');

  const myGeneration = ++streamGeneration;
  const stream = getStreamingClient();
  const main = stream.useChannel('main');
  let disconnectWatchdog: ReturnType<typeof setTimeout> | null = null;

  const initialTimeout = setTimeout(() => {
    if (!streamingConnected) {
      logger.fatal({ generation: myGeneration, currentGeneration: streamGeneration }, 'Initial streaming connection failed within 30s, exiting');
      process.exit(1);
    }
  }, INITIAL_CONNECTION_TIMEOUT);

  stream.on('_connected_', () => {
    streamingConnected = true;
    clearTimeout(initialTimeout);
    if (disconnectWatchdog) {
      clearTimeout(disconnectWatchdog);
      disconnectWatchdog = null;
    }
    logger.info(
      { generation: myGeneration, currentGeneration: streamGeneration },
      'Connected to Misskey Streaming API'
    );
  });

  stream.on('_disconnected_', () => {
    streamingConnected = false;
    if (!disconnectWatchdog) {
      disconnectWatchdog = setTimeout(() => {
        logger.fatal(
          { generation: myGeneration, currentGeneration: streamGeneration },
          'Streaming not recovered within 2 minutes, exiting'
        );
        process.exit(1);
      }, DISCONNECT_FATAL_TIMEOUT);
    }
    logger.warn(
      { generation: myGeneration, currentGeneration: streamGeneration },
      'Disconnected from Misskey Streaming API, RWS will auto-reconnect'
    );
  });

  main.on('mention', (note: Note) => {
    handleMention(note).catch((error) => {
      logger.error({ err: error }, 'Unhandled error in mention handler');
    });
  });
}

export function setBotUsername(username: string): void {
  botUsername = username;
}
