import type { RedditClient } from '@devvit/reddit';
import type { RedisClient } from '@devvit/redis';
import { FALLBACK_RULES_TEXT, REDIS_KEYS, WIKI_CACHE_TTL_SEC } from '../config/constants.js';

export async function getWikiRulesExcerpt(
  reddit: RedditClient,
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

  // Check each category against all rules in priority order so a higher-priority
  // signal (e.g. scam) always wins over a lower-priority one (e.g. domain/promotion)
  // even when both appear in the same signal string.
  const checks: Array<{ trigger: string; matchers: string[] }> = [
    { trigger: 'scam', matchers: ['scam', 'fraud'] },
    { trigger: 'spam', matchers: ['spam'] },
    { trigger: 'domain', matchers: ['link', 'promot'] },
    { trigger: 'account', matchers: ['respect', 'harass'] },
  ];

  for (const { trigger, matchers } of checks) {
    if (!signalText.includes(trigger)) continue;
    const match = lines.find((l) => matchers.some((m) => l.toLowerCase().includes(m)));
    if (match) return match;
  }

  return lines[0] ?? 'Review against subreddit rules (wiki)';
}
