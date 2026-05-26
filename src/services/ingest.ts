import type { RedditClient } from '@devvit/reddit';
import type { RedisClient } from '@devvit/redis';
import { DEDUPE_WINDOW_MS } from '../config/constants.js';
import { parseListSetting, scoreTriageItem } from '../config/scoring.js';
import type { AuthorRecord, IngestInput, InstallationSettings, TriageItem } from '../types.js';
import { classifyWithLlm, cacheLlm, checkLlmRateLimit, getCachedLlm, incrementLlmRate } from './llm.js';
import {
  generateId,
  getItemByThingId,
  incrementReportCount,
  saveItem,
} from './triageStore.js';
import { getWikiRulesExcerpt, matchRuleHeuristic } from './wiki.js';
import { REDIS_KEYS } from '../config/constants.js';

export async function loadInstallationSettings(
  settings: { get: (k: string) => Promise<unknown> },
): Promise<InstallationSettings> {
  const [
    auditMode,
    enableLlm,
    sensitivity,
    customKeywords,
    blockedDomains,
    wikiRulesPage,
    llmMaxPerHour,
  ] = await Promise.all([
    settings.get('auditMode'),
    settings.get('enableLlm'),
    settings.get('sensitivity'),
    settings.get('customKeywords'),
    settings.get('blockedDomains'),
    settings.get('wikiRulesPage'),
    settings.get('llmMaxPerHour'),
  ]);

  return {
    auditMode: auditMode !== false,
    enableLlm: enableLlm !== false,
    sensitivity: (sensitivity as InstallationSettings['sensitivity']) ?? 'balanced',
    customKeywords: String(customKeywords ?? ''),
    blockedDomains: String(blockedDomains ?? ''),
    wikiRulesPage: String(wikiRulesPage ?? 'rules'),
    llmMaxPerHour: Number(llmMaxPerHour ?? 60),
  };
}

async function getAuthorRecord(redis: RedisClient, username: string): Promise<AuthorRecord> {
  const key = REDIS_KEYS.author(username);
  const raw = await redis.hGetAll(key);
  if (!raw || Object.keys(raw).length === 0) {
    return { username, reportsReceived: 0, removalsByMods: 0, lastIncidentAt: '' };
  }
  return {
    username,
    reportsReceived: Number(raw.reportsReceived ?? 0),
    removalsByMods: Number(raw.removalsByMods ?? 0),
    lastIncidentAt: raw.lastIncidentAt ?? '',
  };
}

async function bumpAuthorReport(redis: RedisClient, username: string): Promise<void> {
  const key = REDIS_KEYS.author(username);
  await redis.hIncrBy(key, 'reportsReceived', 1);
  await redis.hSet(key, { lastIncidentAt: new Date().toISOString() });
}

async function fetchAuthorStats(
  reddit: RedditClient,
  username: string,
): Promise<{ accountAgeDays: number; totalKarma: number }> {
  try {
    const user = await reddit.getUserByUsername(username);
    if (!user) return { accountAgeDays: 365, totalKarma: 5000 };
    const created = user.createdAt?.getTime() ?? Date.now();
    const accountAgeDays = (Date.now() - created) / (1000 * 60 * 60 * 24);
    const totalKarma = (user.linkKarma ?? 0) + (user.commentKarma ?? 0);
    return { accountAgeDays, totalKarma };
  } catch {
    return { accountAgeDays: 365, totalKarma: 5000 };
  }
}

export async function ingestAndScore(
  reddit: RedditClient,
  redis: RedisClient,
  settingsClient: { get: (k: string) => Promise<unknown>; getAll: () => Promise<Record<string, unknown>> },
  input: IngestInput,
  appSecrets: { llmApiKey?: string; llmModel?: string },
): Promise<TriageItem> {
  const installSettings = await loadInstallationSettings(settingsClient);
  const existing = await getItemByThingId(redis, input.thingId);

  let reportCount = input.reportCount ?? 1;
  if (existing) {
    const updatedMs = new Date(existing.updatedAt).getTime();
    if (Date.now() - updatedMs < DEDUPE_WINDOW_MS) {
      reportCount = await incrementReportCount(redis, input.thingId);
    } else {
      reportCount = Math.max(existing.reportCount + 1, await incrementReportCount(redis, input.thingId));
    }
  } else {
    await incrementReportCount(redis, input.thingId);
    await bumpAuthorReport(redis, input.authorUsername);
  }

  const authorRecord = await getAuthorRecord(redis, input.authorUsername);
  const repeatOffender = authorRecord.removalsByMods >= 2;
  const { accountAgeDays, totalKarma } = await fetchAuthorStats(reddit, input.authorUsername);

  const keywords = parseListSetting(installSettings.customKeywords, 'scam,crypto,free money,click here');
  const domains = parseListSetting(installSettings.blockedDomains, 'bit.ly,tinyurl.com,crypto');

  const scoring = scoreTriageItem(
    {
      reportCount,
      accountAgeDays,
      totalKarma,
      text: `${input.titleOrSnippet}\n${input.bodyText}`,
      url: input.url,
      automodReason: input.automodReason,
      repeatOffender,
      customKeywords: keywords,
      blockedDomains: domains,
    },
    installSettings.sensitivity,
  );

  const now = new Date().toISOString();
  const item: TriageItem = {
    id: existing?.id ?? generateId(),
    thingId: input.thingId,
    thingType: input.thingType,
    subredditName: input.subredditName,
    authorUsername: input.authorUsername,
    permalink: input.permalink,
    titleOrSnippet: input.titleOrSnippet.slice(0, 500),
    bodyText: input.bodyText.slice(0, 2000),
    source: input.source,
    reportReason: input.reportReason,
    reportCount,
    automodReason: input.automodReason,
    urgencyScore: scoring.urgencyScore,
    riskBand: scoring.riskBand,
    suggestedAction: scoring.suggestedAction,
    heuristicBreakdown: scoring.heuristicBreakdown,
    status: 'open',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const rulesText = await getWikiRulesExcerpt(
    reddit,
    redis,
    input.subredditName,
    installSettings.wikiRulesPage,
  );

  if (!item.llm) {
    item.llm = undefined;
  }

  const shouldEnrich =
    installSettings.enableLlm &&
    (item.riskBand === 'CRITICAL' || item.riskBand === 'HIGH') &&
    appSecrets.llmApiKey;

  if (shouldEnrich) {
    const cached = await getCachedLlm(redis, item.thingId);
    if (cached) {
      item.llm = cached;
    } else if (await checkLlmRateLimit(redis, installSettings.llmMaxPerHour)) {
      const llm = await classifyWithLlm(
        appSecrets.llmApiKey!,
        appSecrets.llmModel ?? 'llama-3.1-8b-instant',
        rulesText,
        item,
      );
      if (llm) {
        item.llm = llm;
        await cacheLlm(redis, item.thingId, llm);
        await incrementLlmRate(redis);
      }
    }
  }

  if (!item.llm && (item.riskBand === 'CRITICAL' || item.riskBand === 'HIGH')) {
    const matched = matchRuleHeuristic(rulesText, item.heuristicBreakdown.signals);
    item.llm = {
      category: 'other',
      matchedRule: matched.replace(/^\d+\.\s*/, '').slice(0, 200),
      oneLineWhy: item.heuristicBreakdown.signals[0] ?? 'Elevated risk signals',
      confidence: item.urgencyScore / 100,
      model: 'heuristic-rules',
      classifiedAt: now,
    };
  }

  await saveItem(redis, item);
  return item;
}

export async function recordAuthorRemoval(redis: RedisClient, username: string): Promise<void> {
  const key = REDIS_KEYS.author(username);
  await redis.hIncrBy(key, 'removalsByMods', 1);
  await redis.hSet(key, { lastIncidentAt: new Date().toISOString() });
}
