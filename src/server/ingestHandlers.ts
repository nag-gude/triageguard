import { reddit } from '@devvit/reddit';
import { redis } from '@devvit/redis';
import { context } from '@devvit/server';
import { settings } from '@devvit/settings';
import type {
  OnAutomoderatorFilterCommentRequest,
  OnAutomoderatorFilterPostRequest,
  OnCommentReportRequest,
  OnPostReportRequest,
} from '@devvit/shared';
import { toT1, toT3 } from './thingIds.js';
import { ingestAndScore } from '../services/ingest.js';
import type { IngestInput } from '../types.js';

async function getAppSecrets(): Promise<{ llmApiKey?: string; llmModel?: string }> {
  const llmApiKey = (await settings.get<string>('llmApiKey')) ?? undefined;
  const llmModel = (await settings.get<string>('llmModel')) ?? 'llama-3.1-8b-instant';
  return { llmApiKey, llmModel };
}

async function runIngest(input: IngestInput): Promise<void> {
  try {
    const secrets = await getAppSecrets();
    await ingestAndScore(reddit, redis, settings, input, secrets);
  } catch (e) {
    console.error('[TriageGuard] Ingest error', e);
  }
}

export async function ingestFromPost(
  postId: string,
  source: IngestInput['source'],
  reportReason?: string,
  automodReason?: string,
  authorFallback?: string,
): Promise<void> {
  const subName = context.subredditName;
  if (!subName) return;

  const fullId = postId.startsWith('t3_') ? postId : `t3_${postId}`;
  const post = await reddit.getPostById(toT3(fullId));

  await runIngest({
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

export async function ingestFromComment(
  commentId: string,
  source: IngestInput['source'],
  reportReason?: string,
  automodReason?: string,
  authorFallback?: string,
): Promise<void> {
  const subName = context.subredditName;
  if (!subName) return;

  const fullId = commentId.startsWith('t1_') ? commentId : `t1_${commentId}`;
  const comment = await reddit.getCommentById(toT1(fullId));

  await runIngest({
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

export async function handlePostReport(input: OnPostReportRequest): Promise<void> {
  const post = input.post;
  if (!post?.id) return;
  await ingestFromPost(post.id, 'post_report', input.reason);
}

export async function handleCommentReport(input: OnCommentReportRequest): Promise<void> {
  const comment = input.comment;
  if (!comment?.id) return;
  await ingestFromComment(comment.id, 'comment_report', input.reason);
}

export async function handleAutomodFilterPost(input: OnAutomoderatorFilterPostRequest): Promise<void> {
  const post = input.post;
  if (!post?.id) return;
  await ingestFromPost(post.id, 'automod_filter', undefined, input.reason, input.author);
}

export async function handleAutomodFilterComment(
  input: OnAutomoderatorFilterCommentRequest,
): Promise<void> {
  const comment = input.comment;
  if (!comment?.id) return;
  await ingestFromComment(comment.id, 'automod_filter', undefined, input.reason, input.author);
}
