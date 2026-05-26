import { reddit } from '@devvit/reddit';
import { redis } from '@devvit/redis';
import { createServer, getServerPort, context } from '@devvit/server';
import { settings } from '@devvit/settings';
import type {
  MenuItemRequest,
  OnAppInstallRequest,
  TriggerResponse,
  UiResponse,
} from '@devvit/shared';
import { toT1, toT3 } from './thingIds.js';
import { Hono } from 'hono';
import { DASHBOARD_TITLE, REDIS_KEYS } from '../config/constants.js';
import { getBandCounts, initStore, listOpenItems, resolveItem } from '../services/triageStore.js';
import { getWikiRulesExcerpt } from '../services/wiki.js';
import {
  handleAutomodFilterComment,
  handleAutomodFilterPost,
  handleCommentReport,
  handlePostReport,
} from './ingestHandlers.js';
import { recordAuthorRemoval } from '../services/ingest.js';
import { cacheModeratorUsernames, checkIsModerator } from './modCheck.js';
import { getRequestListener } from '@hono/node-server';

const app = new Hono();

app.get('/api/debug', async (c) => {
  const headers = Object.fromEntries(Object.entries(c.req.raw.headers));
  let redisResult: string | null | undefined = 'not-tested';
  let redisError: string | null = null;
  try {
    redisResult = await redis.get('__ping__');
  } catch (e) {
    redisError = (e as Error)?.message ?? String(e);
  }
  return c.json({
    headers,
    redisResult,
    redisError,
    contextUsername: context.username,
    contextSubredditName: context.subredditName,
    contextSubredditId: context.subredditId,
  });
});

function normalizeThingId(postId?: string, commentId?: string): string | undefined {
  if (postId) return postId.startsWith('t3_') ? postId : `t3_${postId}`;
  if (commentId) return commentId.startsWith('t1_') ? commentId : `t1_${commentId}`;
  return undefined;
}

app.post('/internal/triggers/app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  const subName = input.subreddit?.name ?? context.subredditName;
  if (!subName) {
    return c.json<TriggerResponse>({});
  }

  await initStore(redis);
  await cacheModeratorUsernames(subName);

  await getWikiRulesExcerpt(
    reddit,
    redis,
    subName,
    String((await settings.get('wikiRulesPage')) ?? 'rules'),
  );

  const post = await reddit.submitCustomPost({
    subredditName: subName,
    title: DASHBOARD_TITLE,
    entry: 'default',
  });

  await redis.set(REDIS_KEYS.dashboardPostId, post.id);
  console.log('[TriageGuard] Installed — dashboard post:', post.id);
  return c.json<TriggerResponse>({});
});

app.post('/internal/triggers/post-report', async (c) => {
  await handlePostReport(await c.req.json());
  return c.json<TriggerResponse>({});
});

app.post('/internal/triggers/comment-report', async (c) => {
  await handleCommentReport(await c.req.json());
  return c.json<TriggerResponse>({});
});

app.post('/internal/triggers/automod-filter-post', async (c) => {
  await handleAutomodFilterPost(await c.req.json());
  return c.json<TriggerResponse>({});
});

app.post('/internal/triggers/automod-filter-comment', async (c) => {
  await handleAutomodFilterComment(await c.req.json());
  return c.json<TriggerResponse>({});
});

app.post('/internal/menu/open-dashboard', async (c) => {
  await c.req.json<MenuItemRequest>();
  const postId = await redis.get(REDIS_KEYS.dashboardPostId);
  if (!postId) {
    return c.json<UiResponse>({ showToast: { text: 'Dashboard post not found — reinstall app', appearance: 'neutral' } });
  }
  const post = await reddit.getPostById(toT3(postId));
  return c.json<UiResponse>({ navigateTo: post.url });
});

app.post('/internal/menu/approve', async (c) => {
  await c.req.json<MenuItemRequest>();
  const thingId = normalizeThingId(context.postId, context.commentId);
  if (!thingId) {
    return c.json<UiResponse>({ showToast: { text: 'Run on a post or comment', appearance: 'neutral' } });
  }
  try {
    if (thingId.startsWith('t3_')) {
      const post = await reddit.getPostById(toT3(thingId));
      await post.approve();
    } else {
      const comment = await reddit.getCommentById(toT1(thingId));
      await comment.approve();
    }
    const mod = context.username ?? (await reddit.getCurrentUsername());
    await resolveItem(redis, thingId, 'resolved', mod ?? undefined);
    return c.json<UiResponse>({ showToast: { text: 'Approved — removed from triage', appearance: 'success' } });
  } catch (e) {
    console.error('[TriageGuard] Approve failed', e);
    return c.json<UiResponse>({ showToast: { text: 'Approve failed', appearance: 'neutral' } });
  }
});

app.post('/internal/menu/remove', async (c) => {
  await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>({
    showForm: {
      name: 'removeConfirm',
      form: {
        title: 'TriageGuard — Confirm removal',
        acceptLabel: 'Remove',
        cancelLabel: 'Cancel',
        fields: [
          {
            type: 'string',
            name: 'confirm',
            label: 'Type REMOVE to confirm',
            required: true,
          },
          {
            type: 'paragraph',
            name: 'reason',
            label: 'Removal note (optional)',
          },
        ],
      },
    },
  });
});

type RemoveFormValues = {
  confirm?: string;
  reason?: string;
};

app.post('/internal/form/remove-submit', async (c) => {
  const values = await c.req.json<RemoveFormValues>();
  const confirm = String(values.confirm ?? '').trim();
  if (confirm.toUpperCase() !== 'REMOVE') {
    return c.json<UiResponse>({ showToast: { text: 'Removal cancelled', appearance: 'neutral' } });
  }

  const thingId = normalizeThingId(context.postId, context.commentId);
  if (!thingId) {
    return c.json<UiResponse>({ showToast: { text: 'Run this on a post or comment', appearance: 'neutral' } });
  }

  try {
    if (thingId.startsWith('t3_')) {
      const post = await reddit.getPostById(toT3(thingId));
      await post.remove();
      if (!post.approved) await post.approve();
    } else {
      const comment = await reddit.getCommentById(toT1(thingId));
      await comment.remove();
    }
    const mod = context.username ?? (await reddit.getCurrentUsername());
    if (mod) {
      const item = await resolveItem(redis, thingId, 'resolved', mod);
      if (item) await recordAuthorRemoval(redis, item.authorUsername);
    }
    return c.json<UiResponse>({ showToast: { text: 'Removed and cleared from triage', appearance: 'success' } });
  } catch (e) {
    console.error('[TriageGuard] Remove failed', e);
    return c.json<UiResponse>({ showToast: { text: 'Remove failed — try again', appearance: 'neutral' } });
  }
});

app.get('/api/triage/summary', async (c) => {
  const username = context.username ?? (await reddit.getCurrentUsername());
  const emptyCounts = { CRITICAL: 0, HIGH: 0, ROUTINE: 0, LIKELY_OK: 0, total: 0 };

  if (!username) {
    return c.json({ isModerator: false, subredditName: '', counts: emptyCounts });
  }

  const { isModerator, subredditName } = await checkIsModerator(username);
  if (!isModerator) {
    return c.json({ isModerator: false, subredditName, counts: emptyCounts });
  }

  try {
    const items = await listOpenItems(redis);
    const counts = await getBandCounts(redis, items);
    return c.json({ isModerator: true, subredditName, counts });
  } catch (e) {
    console.error('[TriageGuard] listOpenItems/getBandCounts failed:', (e as Error)?.message);
    return c.json({ isModerator: true, subredditName, counts: emptyCounts });
  }
});

app.get('/api/triage/mod-check', async (c) => {
  const username = context.username ?? (await reddit.getCurrentUsername());
  if (!username) {
    return c.json({ isModerator: false, subredditName: '' });
  }
  const { isModerator, subredditName } = await checkIsModerator(username);
  return c.json({ isModerator, subredditName });
});

app.get('/api/triage/items', async (c) => {
  const username = context.username ?? (await reddit.getCurrentUsername());
  if (!username) {
    return c.json({ items: [] }, 403);
  }
  const { isModerator } = await checkIsModerator(username);
  if (!isModerator) {
    return c.json({ items: [] }, 403);
  }
  try {
    const items = await listOpenItems(redis);
    return c.json({ items });
  } catch (e) {
    console.error('[TriageGuard] listOpenItems failed:', (e as Error)?.message);
    return c.json({ items: [] });
  }
});

app.post('/api/triage/dismiss', async (c) => {
  const username = context.username ?? (await reddit.getCurrentUsername());
  if (!username) {
    return c.json({ ok: false, error: 'Unauthorized' }, 403);
  }
  const { isModerator } = await checkIsModerator(username);
  if (!isModerator) {
    return c.json({ ok: false, error: 'Moderators only' }, 403);
  }

  const { thingId } = await c.req.json<{ thingId: string }>();
  if (!thingId) {
    return c.json({ ok: false, error: 'thingId required' }, 400);
  }
  await resolveItem(redis, thingId, 'dismissed');
  return c.json({ ok: true });
});

const port = getServerPort();
const server = createServer(getRequestListener(app.fetch));
server.on('error', (err) => console.error('[TriageGuard] server error', err));
server.listen(port, () => console.log(`[TriageGuard] server listening on ${port}`));
