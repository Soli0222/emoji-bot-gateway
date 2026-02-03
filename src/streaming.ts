import type { Note } from 'misskey-js/entities.js';
import { getStreamingClient } from './services/misskey.js';
import { valkey } from './services/valkey.js';
import { shouldProcessMention, extractMessageContent } from './logic/filter.js';
import { generateAndPropose } from './logic/generator.js';
import { handleConfirmation } from './logic/registrar.js';
import { logger } from './logger.js';

// Bot username - will be set during initialization
let botUsername = '';

/**
 * Fibonacci backoff for reconnection
 */
function fibonacciBackoff(attempt: number): number {
  const fib = [1, 1];
  for (let i = 2; i <= attempt; i++) {
    fib[i] = fib[i - 1] + fib[i - 2];
  }
  return Math.min(fib[attempt] * 1000, 60000); // Max 60 seconds
}

/**
 * Handle incoming mention event
 */
async function handleMention(note: Note): Promise<void> {
  // Phase 1: Filtering
  if (!shouldProcessMention(note)) {
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
      // Phase 2: New generation request
      logger.debug({ userId }, 'No state found, starting generation');
      await generateAndPropose(userId, message, note.id);
    }
  } catch (error) {
    logger.error({ err: error, userId, noteId: note.id }, 'Error handling mention');
  }
}

/**
 * Start the streaming connection
 */
export async function startStreaming(): Promise<void> {
  let reconnectAttempt = 0;

  const connect = () => {
    logger.info('Connecting to Misskey Streaming API...');

    const stream = getStreamingClient();
    const main = stream.useChannel('main');

    stream.on('_connected_', () => {
      logger.info('Connected to Misskey Streaming API');
      reconnectAttempt = 0;
    });

    stream.on('_disconnected_', () => {
      logger.warn('Disconnected from Misskey Streaming API');
      scheduleReconnect();
    });

    main.on('mention', (note: Note) => {
      handleMention(note).catch((error) => {
        logger.error({ err: error }, 'Unhandled error in mention handler');
      });
    });

    const scheduleReconnect = () => {
      reconnectAttempt++;
      const delay = fibonacciBackoff(reconnectAttempt);
      logger.info({ attempt: reconnectAttempt, delay }, 'Scheduling reconnect');
      setTimeout(connect, delay);
    };
  };

  connect();
}

export function setBotUsername(username: string): void {
  botUsername = username;
}
