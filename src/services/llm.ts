import type { RedisClient } from '@devvit/redis';
import { REDIS_KEYS } from '../config/constants.js';
import type { LlmExplanation, TriageItem } from '../types.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';

export async function checkLlmRateLimit(redis: RedisClient, maxPerHour: number): Promise<boolean> {
  const bucket = new Date().toISOString().slice(0, 13);
  const stored = await redis.get(REDIS_KEYS.llmHourBucket);
  if (stored !== bucket) {
    await redis.set(REDIS_KEYS.llmHourBucket, bucket);
    await redis.set(REDIS_KEYS.llmHourCount, '0');
  }
  const count = Number((await redis.get(REDIS_KEYS.llmHourCount)) ?? '0');
  return count < maxPerHour;
}

export async function incrementLlmRate(redis: RedisClient): Promise<void> {
  await redis.incrBy(REDIS_KEYS.llmHourCount, 1);
}

export async function getCachedLlm(redis: RedisClient, thingId: string): Promise<LlmExplanation | null> {
  const raw = await redis.get(REDIS_KEYS.llmCache(thingId));
  if (!raw) return null;
  return JSON.parse(raw) as LlmExplanation;
}

export async function cacheLlm(redis: RedisClient, thingId: string, explanation: LlmExplanation): Promise<void> {
  await redis.set(REDIS_KEYS.llmCache(thingId), JSON.stringify(explanation));
}

export async function classifyWithLlm(
  apiKey: string,
  model: string,
  rulesExcerpt: string,
  item: TriageItem,
): Promise<LlmExplanation | null> {
  const system = `You are a subreddit moderation assistant. Match content to the subreddit rules.
Respond with JSON only, no markdown:
{"category":"scam|hate|raid|nsfw|spam|misinformation|harassment|other","matchedRule":"quote or paraphrase one rule","oneLineWhy":"single sentence for mods","confidence":0.0-1.0}`;

  const userPayload = {
    rules_excerpt: rulesExcerpt.slice(0, 3000),
    content: {
      type: item.thingType,
      title: item.titleOrSnippet,
      body: item.bodyText.slice(0, 2000),
    },
    report_reason: item.reportReason ?? '',
    heuristic_signals: item.heuristicBreakdown.signals,
  };

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!response.ok) {
    console.error('[TriageGuard] LLM HTTP error', response.status, await response.text());
    return null;
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as {
      category?: string;
      matchedRule?: string;
      oneLineWhy?: string;
      confidence?: number;
    };
    return {
      category: parsed.category ?? 'other',
      matchedRule: parsed.matchedRule ?? 'See subreddit rules',
      oneLineWhy: parsed.oneLineWhy ?? 'Flagged for moderator review',
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.75)),
      model: model || DEFAULT_MODEL,
      classifiedAt: new Date().toISOString(),
    };
  } catch {
    console.error('[TriageGuard] LLM JSON parse failed', content);
    return null;
  }
}
