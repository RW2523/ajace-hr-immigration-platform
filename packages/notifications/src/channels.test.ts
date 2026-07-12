/**
 * Channel-resolution unit tests — the production seams that don't need a DB:
 *   - fail LOUD when the email channel is expected but RESEND_API_KEY is missing in prod
 *   - degrade to a console sink (with a warning) only in dev/test
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConsoleChannel, MissingEmailChannel, ResendChannel, resolveChannels } from './channels.js';

const ENV_KEYS = ['NODE_ENV', 'NOTIFICATIONS_PROD', 'RESEND_API_KEY'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveChannels — email fail-loud in production', () => {
  it('uses a fail-loud channel (never a fake success) when prod-like and key missing', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NOTIFICATIONS_PROD = '1';
    const email = resolveChannels().email!;
    expect(email).toBeInstanceOf(MissingEmailChannel);
    await expect(
      email.send({ to: 'x@y.z', subject: 's', body: 'b', channel: 'email' }),
    ).rejects.toThrow(/RESEND_API_KEY/);
  });

  it('uses the real Resend adapter when the key is present', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.NOTIFICATIONS_PROD = '1';
    const email = resolveChannels().email!;
    expect(email).toBeInstanceOf(ResendChannel);
  });

  it('degrades to a console sink only in dev/test (no key, not prod)', () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.NOTIFICATIONS_PROD;
    process.env.NODE_ENV = 'test';
    const email = resolveChannels().email!;
    expect(email).toBeInstanceOf(ConsoleChannel);
  });
});
