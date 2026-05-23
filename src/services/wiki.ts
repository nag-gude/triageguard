import type { RedditAPIClient, RedisClient } from '@devvit/public-api';
import { FALLBACK_RULES_TEXT, REDIS_KEYS, WIKI_CACHE_TTL_SEC } from '../config/constants.js';

export async function getWikiRulesExcerpt(
  reddit: RedditAPIClient,
  redis: RedisClient,
  subredditName: string,
  wikiPage: string,
): Promise<string> {
  const cached = await redis.get(REDIS_KEYS.wikiRules);
  const fetchedAt = await redis.get(REDIS_KEYS.wikiFetchedAt);
  if (cached && fetchedAt) {
    const ageSec = (Date.now() - Number(fetchedAt)) / 1000;
    if (ageSec < WIKI_CACHE_TTL_SEC) return cached;
  }

  let content = FALLBACK_RULES_TEXT;
  try {
    const page = await reddit.getWikiPage(subredditName, wikiPage);
    if (page?.content?.trim()) {
      content = page.content.trim();
    }
  } catch (e) {
    console.warn('[TriageGuard] Wiki fetch failed, using fallback rules', e);
  }

  const excerpt = content.slice(0, 4000);
  await redis.set(REDIS_KEYS.wikiRules, excerpt);
  await redis.set(REDIS_KEYS.wikiFetchedAt, String(Date.now()));
  return excerpt;
}

/** Pick a rule line that best matches heuristic signals (heuristic-only path). */
export function matchRuleHeuristic(rulesText: string, signals: string[]): string {
  const lines = rulesText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 10);

  const signalText = signals.join(' ').toLowerCase();
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (signalText.includes('scam') && (lower.includes('scam') || lower.includes('fraud'))) return line;
    if (signalText.includes('spam') && lower.includes('spam')) return line;
    if (signalText.includes('domain') && (lower.includes('link') || lower.includes('promot'))) return line;
    if (signalText.includes('account') && (lower.includes('respect') || lower.includes('harass'))) return line;
  }
  return lines[0] ?? 'Review against subreddit rules (wiki)';
}
