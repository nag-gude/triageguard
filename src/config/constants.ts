export const SCHEMA_VERSION = '1';
export const DASHBOARD_TITLE = 'TriageGuard — Mod Triage';
export const MAX_OPEN_ITEMS = 20;
export const LLM_CACHE_TTL_SEC = 7 * 24 * 60 * 60;
export const WIKI_CACHE_TTL_SEC = 24 * 60 * 60;
export const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export const DEFAULT_BLOCKED_DOMAINS =
  'bit.ly,tinyurl.com,t.co,crypto,binance,coinbase,telegram.gg,discord.gg';

export const FALLBACK_RULES_TEXT = `
1. Be respectful — No harassment or hate.
2. No spam — No unsolicited promotion or repetitive content.
3. No scams — No fraudulent links or phishing.
4. Stay on topic — Content must fit the community.
`.trim();

export const REDIS_KEYS = {
  schemaVersion: 'tg:schema_version',
  dashboardPostId: 'tg:dashboard_post_id',
  modUsernames: 'tg:mod_usernames',
  wikiRules: 'tg:wiki:rules',
  wikiFetchedAt: 'tg:wiki:fetched_at',
  openQueue: 'tg:open',
  llmHourCount: 'tg:llm:hour_count',
  llmHourBucket: 'tg:llm:hour_bucket',
  item: (id: string) => `tg:item:${id}`,
  thingIndex: (thingId: string) => `tg:thing:${thingId}`,
  reportCount: (thingId: string) => `tg:reportcount:${thingId}`,
  llmCache: (thingId: string) => `tg:llm:${thingId}`,
  author: (username: string) => `tg:author:${username.toLowerCase()}`,
} as const;
