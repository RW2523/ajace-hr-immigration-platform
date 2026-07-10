/**
 * Loads notification triggers. Currently reads the versioned seed file directly;
 * once counsel-ratified offsets live in a DB table, swap this to a DB read behind
 * the same signature. Validated against the shared zod schema on load.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notificationTriggerRowSchema, type NotificationTriggerRow } from '@hr/shared';

const here = dirname(fileURLToPath(import.meta.url));
const seedFile = join(here, '..', '..', '..', 'data', 'immigration-seed', 'notification_triggers.json');

export async function loadTriggers(): Promise<NotificationTriggerRow[]> {
  const parsed = JSON.parse(readFileSync(seedFile, 'utf8'));
  return parsed.triggers.map((t: unknown) => notificationTriggerRowSchema.parse(t));
}
