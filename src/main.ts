import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from './logger.js';
import { config } from './config.js';
import { valkey } from './services/valkey.js';
import { misskeyClient } from './services/misskey.js';
import { fetchFontList } from './services/renderer.js';
import { startStreaming, setBotUsername } from './streaming.js';

const app = new Hono();

// Health check endpoint
app.get('/health', async (c) => {
  const valkeyOk = await valkey.ping();

  const status = {
    status: valkeyOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: {
      valkey: valkeyOk ? 'ok' : 'error',
    },
  };

  return c.json(status, valkeyOk ? 200 : 503);
});

// Metrics endpoint (basic)
app.get('/metrics', async (c) => {
  return c.text(`# HELP emoji_bot_up Service availability
# TYPE emoji_bot_up gauge
emoji_bot_up 1
`);
});

async function initialize(): Promise<void> {
  logger.info('Initializing Emoji Bot Gateway...');

  // Step 1: Fetch bot account info
  try {
    const me = await misskeyClient.request('i', {});
    setBotUsername(me.username);
    logger.info({ username: me.username }, 'Bot account identified');
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch bot account info');
    throw error;
  }

  // Step 2: Pre-fetch font list from Service A
  try {
    await fetchFontList();
    logger.info('Font list cached');
  } catch (error) {
    logger.warn({ err: error }, 'Failed to fetch font list, will retry on first request');
  }

  // Step 3: Start streaming connection
  await startStreaming();
}

async function main(): Promise<void> {
  // Start HTTP server for health checks
  serve({
    fetch: app.fetch,
    port: config.PORT,
  }, (info) => {
    logger.info({ port: info.port }, 'HTTP server started');
  });

  // Initialize services and start streaming
  await initialize();

  logger.info('Emoji Bot Gateway is running');
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down...');
  await valkey.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down...');
  await valkey.close();
  process.exit(0);
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection');
});

main().catch((error) => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
