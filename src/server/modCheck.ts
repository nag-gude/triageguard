import { reddit } from '@devvit/reddit';
import { redis } from '@devvit/redis';
import { context } from '@devvit/server';
import { REDIS_KEYS } from '../config/constants.js';

/** Strip r/ prefix; Reddit API expects bare subreddit name. */
export function normalizeSubredditName(name: string): string {
  return name.replace(/^r\//i, '').trim();
}

async function resolveSubredditName(): Promise<string | undefined> {
  if (context.subredditName) {
    return normalizeSubredditName(context.subredditName);
  }
  try {
    const sub = await reddit.getCurrentSubreddit();
    return sub?.name ? normalizeSubredditName(sub.name) : undefined;
  } catch (e) {
    console.warn('[TriageGuard] getCurrentSubreddit failed', e);
    return undefined;
  }
}

async function getCachedModUsernames(): Promise<string[] | null> {
  try {
    const raw = await redis.get(REDIS_KEYS.modUsernames);
    if (!raw) return null;
    const list = JSON.parse(raw) as string[];
    return Array.isArray(list) ? list : null;
  } catch (e) {
    console.warn('[TriageGuard] Redis get failed in getCachedModUsernames:', (e as Error)?.message ?? e);
    return null;
  }
}

/** Called from AppInstall to cache mods when Reddit API works in trigger context. */
export async function cacheModeratorUsernames(subredditName: string): Promise<void> {
  const name = normalizeSubredditName(subredditName);
  try {
    const mods = await reddit.getModerators({ subredditName: name, limit: 100 }).all();
    const usernames = mods.map((m) => m.username).filter(Boolean);
    await redis.set(REDIS_KEYS.modUsernames, JSON.stringify(usernames));
    console.log('[TriageGuard] Cached mod list:', usernames.length);
  } catch (e) {
    console.warn('[TriageGuard] Could not cache mod list on install', e);
  }
}

/**
 * Check if the current user moderates the installation subreddit.
 */
export async function checkIsModerator(username: string): Promise<{
  isModerator: boolean;
  subredditName: string;
}> {
  const subredditName = (await resolveSubredditName()) ?? '';

  if (!username || !subredditName) {
    return { isModerator: false, subredditName };
  }

  const cached = await getCachedModUsernames();
  if (cached) {
    const hit = cached.some((m) => m.toLowerCase() === username.toLowerCase());
    if (hit) return { isModerator: true, subredditName };
    return { isModerator: false, subredditName };
  }

  try {
    const mods = await reddit
      .getModerators({
        subredditName,
        username,
        limit: 1,
      })
      .all();
    return { isModerator: mods.length > 0, subredditName };
  } catch (e) {
    console.error('[TriageGuard] getModerators failed', {
      subredditName,
      username,
      subredditId: context.subredditId,
      error: e,
    });

    // Playtest fallback: moderator-scoped app + authenticated user in sub context.
    // Reinstall app to populate tg:mod_usernames cache when API works on install.
    if (context.subredditId && username) {
      console.warn(
        '[TriageGuard] Allowing dashboard for authenticated user (no mod cache; reinstall app to refresh mod list)',
      );
      return { isModerator: true, subredditName };
    }
    return { isModerator: false, subredditName };
  }
}
