import type { RedisClient } from '@devvit/redis';
import { MAX_OPEN_ITEMS, REDIS_KEYS, SCHEMA_VERSION } from '../config/constants.js';
import type { BandCounts, RiskBand, TriageItem, TriageStatus } from '../types.js';

export function generateId(): string {
  return `tg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function initStore(redis: RedisClient): Promise<void> {
  await redis.set(REDIS_KEYS.schemaVersion, SCHEMA_VERSION);
}

export async function saveItem(redis: RedisClient, item: TriageItem): Promise<void> {
  await redis.set(REDIS_KEYS.item(item.id), JSON.stringify(item));
  await redis.set(REDIS_KEYS.thingIndex(item.thingId), item.id);

  if (item.status === 'open') {
    await redis.zAdd(REDIS_KEYS.openQueue, { member: item.id, score: item.urgencyScore });
  } else {
    await redis.zRem(REDIS_KEYS.openQueue, [item.id]);
  }
}

export async function getItemById(redis: RedisClient, id: string): Promise<TriageItem | null> {
  const raw = await redis.get(REDIS_KEYS.item(id));
  if (!raw) return null;
  return JSON.parse(raw) as TriageItem;
}

export async function getItemByThingId(redis: RedisClient, thingId: string): Promise<TriageItem | null> {
  const id = await redis.get(REDIS_KEYS.thingIndex(thingId));
  if (!id) return null;
  return getItemById(redis, id);
}

export async function incrementReportCount(redis: RedisClient, thingId: string): Promise<number> {
  const key = REDIS_KEYS.reportCount(thingId);
  const next = await redis.incrBy(key, 1);
  return next;
}

export async function listOpenItems(redis: RedisClient, limit = MAX_OPEN_ITEMS): Promise<TriageItem[]> {
  const ranked = await redis.zRange(REDIS_KEYS.openQueue, 0, limit - 1, {
    reverse: true,
    by: 'score',
  });
  const ids = ranked.map((entry) => entry.member);
  const items: TriageItem[] = [];
  for (const id of ids) {
    const item = await getItemById(redis, id);
    if (item && item.status === 'open') items.push(item);
  }
  items.sort((a, b) => {
    if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return items.slice(0, limit);
}

export async function getBandCounts(redis: RedisClient, items: TriageItem[]): Promise<BandCounts> {
  const counts: BandCounts = { CRITICAL: 0, HIGH: 0, ROUTINE: 0, LIKELY_OK: 0, total: items.length };
  for (const item of items) {
    counts[item.riskBand] += 1;
  }
  return counts;
}

export async function resolveItem(
  redis: RedisClient,
  thingId: string,
  status: TriageStatus,
  resolvedBy?: string,
): Promise<TriageItem | null> {
  const item = await getItemByThingId(redis, thingId);
  if (!item) return null;
  item.status = status;
  item.updatedAt = new Date().toISOString();
  item.resolvedAt = item.updatedAt;
  if (resolvedBy) item.resolvedBy = resolvedBy;
  await saveItem(redis, item);
  return item;
}

export function filterByBand(items: TriageItem[], band: RiskBand | 'ALL'): TriageItem[] {
  if (band === 'ALL') return items;
  return items.filter((i) => i.riskBand === band);
}
