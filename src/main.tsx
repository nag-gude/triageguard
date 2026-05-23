import { Devvit, SettingScope } from '@devvit/public-api';
import {
  CUSTOM_POST_NAME,
  DASHBOARD_TITLE,
  REDIS_KEYS,
} from './config/constants.js';
import { ingestAndScore, loadInstallationSettings, recordAuthorRemoval } from './services/ingest.js';
import { initStore, resolveItem } from './services/triageStore.js';
import { getWikiRulesExcerpt } from './services/wiki.js';
import type { IngestInput } from './types.js';
import { TriageDashboardRoot } from './ui/dashboard.js';

Devvit.configure({
  redditAPI: true,
  redis: true,
  http: {
    domains: ['api.groq.com'],
  },
});

Devvit.addSettings([
  {
    type: 'boolean',
    name: 'auditMode',
    label: 'Audit mode (confirm removals)',
    defaultValue: true,
    scope: SettingScope.Installation,
  },
  {
    type: 'boolean',
    name: 'enableLlm',
    label: 'Enable rule enrichment (Critical/High)',
    defaultValue: true,
    scope: SettingScope.Installation,
  },
  {
    type: 'select',
    name: 'sensitivity',
    label: 'Scoring sensitivity',
    options: [
      { label: 'Strict', value: 'strict' },
      { label: 'Balanced', value: 'balanced' },
      { label: 'Relaxed', value: 'relaxed' },
    ],
    defaultValue: ['balanced'],
    scope: SettingScope.Installation,
  },
  {
    type: 'string',
    name: 'customKeywords',
    label: 'Custom keywords (comma-separated)',
    defaultValue: '',
    scope: SettingScope.Installation,
  },
  {
    type: 'string',
    name: 'blockedDomains',
    label: 'Blocked domains (comma-separated)',
    defaultValue: 'bit.ly,tinyurl.com,crypto,binance',
    scope: SettingScope.Installation,
  },
  {
    type: 'string',
    name: 'wikiRulesPage',
    label: 'Wiki rules page name',
    defaultValue: 'rules',
    scope: SettingScope.Installation,
  },
  {
    type: 'number',
    name: 'llmMaxPerHour',
    label: 'Max LLM calls per hour',
    defaultValue: 60,
    scope: SettingScope.Installation,
  },
  {
    type: 'string',
    name: 'llmApiKey',
    label: 'Groq API key (app secret)',
    isSecret: true,
    scope: SettingScope.App,
  },
  {
    type: 'string',
    name: 'llmModel',
    label: 'Groq model id',
    defaultValue: 'llama-3.1-8b-instant',
    scope: SettingScope.App,
  },
]);

const removeForm = Devvit.createForm(
  {
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
  async (event, context) => {
    const confirm = String(event.values.confirm ?? '').trim();
    if (confirm.toUpperCase() !== 'REMOVE') {
      context.ui.showToast({ text: 'Removal cancelled', appearance: 'neutral' });
      return;
    }

    const thingId = normalizeThingId(context.postId, context.commentId);
    if (!thingId) {
      context.ui.showToast({ text: 'Run this on a post or comment', appearance: 'neutral' });
      return;
    }

    try {
      if (thingId.startsWith('t3_')) {
        const post = await context.reddit.getPostById(thingId);
        await post.remove();
        if (!post.approved) await post.approve();
      } else {
        const comment = await context.reddit.getCommentById(thingId);
        await comment.remove();
      }
      const mod = await context.reddit.getCurrentUsername();
      if (mod) {
        const item = await resolveItem(context.redis, thingId, 'resolved', mod);
        if (item) await recordAuthorRemoval(context.redis, item.authorUsername);
      }
      context.ui.showToast({ text: 'Removed and cleared from triage', appearance: 'success' });
    } catch (e) {
      console.error('[TriageGuard] Remove failed', e);
      context.ui.showToast({ text: 'Remove failed — try again', appearance: 'neutral' });
    }
  },
);

function normalizeThingId(postId?: string, commentId?: string): string | undefined {
  if (postId) return postId.startsWith('t3_') ? postId : `t3_${postId}`;
  if (commentId) return commentId.startsWith('t1_') ? commentId : `t1_${commentId}`;
  return undefined;
}

async function getAppSecrets(settings: Devvit.Context['settings']): Promise<{
  llmApiKey?: string;
  llmModel?: string;
}> {
  const llmApiKey = (await settings.get<string>('llmApiKey')) ?? undefined;
  const llmModel = (await settings.get<string>('llmModel')) ?? 'llama-3.1-8b-instant';
  return { llmApiKey, llmModel };
}

type IngestContext = Pick<Devvit.Context, 'reddit' | 'redis' | 'settings' | 'subredditName'>;

async function runIngest(context: IngestContext, input: IngestInput): Promise<void> {
  try {
    const secrets = await getAppSecrets(context.settings);
    await ingestAndScore(context.reddit, context.redis, context.settings, input, secrets);
  } catch (e) {
    console.error('[TriageGuard] Ingest error', e);
  }
}

Devvit.addTrigger({
  event: 'AppInstall',
  async onEvent(_event, context) {
    await initStore(context.redis);
    const subName = context.subredditName;
    if (!subName) return;

    await getWikiRulesExcerpt(
      context.reddit,
      context.redis,
      subName,
      String((await context.settings.get('wikiRulesPage')) ?? 'rules'),
    );

    const post = await context.reddit.submitPost({
      subredditName: subName,
      title: DASHBOARD_TITLE,
      preview: (
        <vstack alignment="center middle" padding="large" gap="medium" backgroundColor="#0f0f1a">
          <text size="xxlarge" weight="bold" color="#FFFFFF">
            TriageGuard
          </text>
          <text size="medium" color="#4ECDC4" alignment="center">
            Prioritized mod triage — open this post to review the queue
          </text>
        </vstack>
      ),
    });

    await context.redis.set(REDIS_KEYS.dashboardPostId, post.id);
    console.log('[TriageGuard] Installed — dashboard post:', post.id);
  },
});

async function ingestFromPost(
  context: IngestContext,
  postId: string,
  source: IngestInput['source'],
  reportReason?: string,
  automodReason?: string,
  authorFallback?: string,
): Promise<void> {
  const subName = context.subredditName;
  if (!subName) return;

  const fullId = postId.startsWith('t3_') ? postId : `t3_${postId}`;
  const post = await context.reddit.getPostById(fullId);

  await runIngest(context, {
    thingId: fullId,
    thingType: 'post',
    subredditName: subName,
    authorUsername: post.authorName ?? authorFallback ?? 'unknown',
    permalink: post.permalink,
    titleOrSnippet: post.title ?? '(post)',
    bodyText: post.body ?? '',
    url: post.url,
    source,
    reportReason,
    automodReason,
    reportCount: post.numberOfReports ?? 1,
  });
}

async function ingestFromComment(
  context: IngestContext,
  commentId: string,
  source: IngestInput['source'],
  reportReason?: string,
  automodReason?: string,
  authorFallback?: string,
): Promise<void> {
  const subName = context.subredditName;
  if (!subName) return;

  const fullId = commentId.startsWith('t1_') ? commentId : `t1_${commentId}`;
  const comment = await context.reddit.getCommentById(fullId);

  await runIngest(context, {
    thingId: fullId,
    thingType: 'comment',
    subredditName: subName,
    authorUsername: comment.authorName ?? authorFallback ?? 'unknown',
    permalink: comment.permalink,
    titleOrSnippet: (comment.body ?? '(comment)').slice(0, 200),
    bodyText: comment.body ?? '',
    source,
    reportReason,
    automodReason,
    reportCount: comment.numReports ?? 1,
  });
}

Devvit.addTrigger({
  event: 'PostReport',
  async onEvent(event, context) {
    const post = event.post;
    if (!post?.id) return;
    await ingestFromPost(context, post.id, 'post_report', event.reason);
  },
});

Devvit.addTrigger({
  event: 'CommentReport',
  async onEvent(event, context) {
    const comment = event.comment;
    if (!comment?.id) return;
    await ingestFromComment(context, comment.id, 'comment_report', event.reason);
  },
});

Devvit.addTrigger({
  event: 'AutomoderatorFilterPost',
  async onEvent(event, context) {
    const post = event.post;
    if (!post?.id) return;
    await ingestFromPost(context, post.id, 'automod_filter', undefined, event.reason, event.author);
  },
});

Devvit.addTrigger({
  event: 'AutomoderatorFilterComment',
  async onEvent(event, context) {
    const comment = event.comment;
    if (!comment?.id) return;
    await ingestFromComment(
      context,
      comment.id,
      'automod_filter',
      undefined,
      event.reason,
      event.author,
    );
  },
});

Devvit.addCustomPostType({
  name: CUSTOM_POST_NAME,
  description: 'TriageGuard prioritized moderation dashboard',
  height: 'tall',
  render: (context) => TriageDashboardRoot(context),
});

Devvit.addMenuItem({
  label: 'TriageGuard: Open Dashboard',
  description: 'Open the prioritized mod triage dashboard',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const postId = await context.redis.get(REDIS_KEYS.dashboardPostId);
    if (!postId) {
      context.ui.showToast({ text: 'Dashboard post not found — reinstall app', appearance: 'neutral' });
      return;
    }
    const post = await context.reddit.getPostById(postId);
    context.ui.navigateTo(post);
  },
});

Devvit.addMenuItem({
  label: 'TriageGuard: Approve',
  description: 'Approve and clear from triage list',
  location: ['post', 'comment'],
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const thingId = normalizeThingId(context.postId, context.commentId);
    if (!thingId) {
      context.ui.showToast({ text: 'Run on a post or comment', appearance: 'neutral' });
      return;
    }
    try {
      if (thingId.startsWith('t3_')) {
        const post = await context.reddit.getPostById(thingId);
        await post.approve();
      } else {
        const comment = await context.reddit.getCommentById(thingId);
        await comment.approve();
      }
      const mod = await context.reddit.getCurrentUsername();
      await resolveItem(context.redis, thingId, 'resolved', mod ?? undefined);
      context.ui.showToast({ text: 'Approved — removed from triage', appearance: 'success' });
    } catch (e) {
      console.error('[TriageGuard] Approve failed', e);
      context.ui.showToast({ text: 'Approve failed', appearance: 'neutral' });
    }
  },
});

Devvit.addMenuItem({
  label: 'TriageGuard: Remove',
  description: 'Remove with confirmation (audit mode)',
  location: ['post', 'comment'],
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const install = await loadInstallationSettings(context.settings);
    if (install.auditMode) {
      context.ui.showForm(removeForm);
      return;
    }
    context.ui.showForm(removeForm);
  },
});

export default Devvit;
