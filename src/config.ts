import { z } from 'zod';

const envSchema = z.object({
  // Misskey Configuration
  MISSKEY_HOST: z.string().describe('Misskey instance host (e.g., misskey.example.com)'),
  MISSKEY_TOKEN: z.string().describe('Misskey API token with admin privileges'),

  // Service A (Renderer) Configuration
  RENDERER_BASE_URL: z.string().url().describe('Base URL for Service A (font/renderer service)'),

  // Valkey (Redis) Configuration
  VALKEY_HOST: z.string().default('localhost'),
  VALKEY_PORT: z.coerce.number().default(6379),
  VALKEY_PASSWORD: z.string().optional(),

  // OpenAI Configuration
  OPENAI_API_KEY: z.string().describe('OpenAI API key'),
  OPENAI_MODEL: z.string().default('gpt-5-mini-2025-08-07'),

  // Server Configuration
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Rate Limiting
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(10),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),

  // State TTL
  STATE_TTL_SECONDS: z.coerce.number().default(600), // 10 minutes
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

export type Config = z.infer<typeof envSchema>;
