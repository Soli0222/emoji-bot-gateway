import { beforeEach, describe, expect, it, vi } from 'vitest';

const streamHandlers = new Map<string, Array<() => void>>();
const channelHandlers = new Map<string, Array<(payload: unknown) => void>>();
const mockUseChannel = vi.fn(() => ({
  on: vi.fn((event: string, handler: (payload: unknown) => void) => {
    const handlers = channelHandlers.get(event) ?? [];
    handlers.push(handler);
    channelHandlers.set(event, handlers);
  }),
}));

function emitStream(event: string): void {
  for (const handler of streamHandlers.get(event) ?? []) {
    handler();
  }
}

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('./services/misskey.js', () => ({
  getStreamingClient: vi.fn(() => ({
    useChannel: mockUseChannel,
    on: vi.fn((event: string, handler: () => void) => {
      const handlers = streamHandlers.get(event) ?? [];
      handlers.push(handler);
      streamHandlers.set(event, handlers);
    }),
  })),
}));

vi.mock('./services/valkey.js', () => ({
  valkey: {
    markNoteProcessed: vi.fn().mockResolvedValue(true),
    checkRateLimit: vi.fn().mockResolvedValue(true),
    getState: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('./logic/filter.js', () => ({
  shouldProcessMention: vi.fn().mockReturnValue(true),
  extractMessageContent: vi.fn().mockReturnValue('test message'),
}));

vi.mock('./logic/generator.js', () => ({
  generateAndPropose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./logic/registrar.js', () => ({
  analyzeUserResponse: vi.fn().mockReturnValue('unknown'),
  handleConfirmation: vi.fn().mockResolvedValue(undefined),
}));

describe('streaming', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    streamHandlers.clear();
    channelHandlers.clear();
  });

  it('tracks streaming connection state via stream events', async () => {
    const { startStreaming, isStreamingConnected } = await import('./streaming.js');

    await startStreaming();
    expect(isStreamingConnected()).toBe(false);

    emitStream('_connected_');
    expect(isStreamingConnected()).toBe(true);

    emitStream('_disconnected_');
    expect(isStreamingConnected()).toBe(false);
  });

  it('exits if initial connection is not established within 30 seconds', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    });
    const { startStreaming } = await import('./streaming.js');

    await startStreaming();

    expect(() => vi.advanceTimersByTime(30_000)).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('starts a fatal watchdog on disconnect and clears it after recovery', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    });
    const { startStreaming } = await import('./streaming.js');

    await startStreaming();
    emitStream('_connected_');
    emitStream('_disconnected_');

    vi.advanceTimersByTime(119_000);
    expect(exitSpy).not.toHaveBeenCalled();

    emitStream('_connected_');
    vi.advanceTimersByTime(5_000);
    expect(exitSpy).not.toHaveBeenCalled();

    emitStream('_disconnected_');
    expect(() => vi.advanceTimersByTime(120_000)).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
