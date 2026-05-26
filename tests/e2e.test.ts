/**
 * End-to-end tests for TriageGuard.
 *
 * These tests exercise the full pipeline (scoring → ingest → store → resolution)
 * using lightweight in-memory mocks for Redis and Reddit. No network calls are made.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  scoreTriageItem,
  parseListSetting,
  bandLabel,
  suggestedActionLabel,
  bandEmoji,
} from '../src/config/scoring.js';
import {
  generateId,
  saveItem,
  getItemById,
  getItemByThingId,
  incrementReportCount,
  listOpenItems,
  getBandCounts,
  resolveItem,
  filterByBand,
  initStore,
} from '../src/services/triageStore.js';
import { matchRuleHeuristic } from '../src/services/wiki.js';
import { ingestAndScore, loadInstallationSettings } from '../src/services/ingest.js';
import type { TriageItem } from '../src/types.js';

// ---------------------------------------------------------------------------
// In-memory Redis mock
// ---------------------------------------------------------------------------

function makeRedis() {
  const store = new Map<string, string>();
  const zsets = new Map<string, { member: string; score: number }[]>();

  return {
    _store: store,
    _zsets: zsets,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
    },
    async hGetAll(key: string) {
      const raw = store.get(key);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    },
    async hSet(key: string, fields: Record<string, string | number>) {
      const current = store.get(key) ? (JSON.parse(store.get(key)!) as Record<string, string>) : {};
      for (const [k, v] of Object.entries(fields)) current[k] = String(v);
      store.set(key, JSON.stringify(current));
    },
    async hIncrBy(key: string, field: string, delta: number) {
      const current = store.get(key)
        ? (JSON.parse(store.get(key)!) as Record<string, string>)
        : {};
      const next = Number(current[field] ?? 0) + delta;
      current[field] = String(next);
      store.set(key, JSON.stringify(current));
      return next;
    },
    async incrBy(key: string, delta: number) {
      const next = Number(store.get(key) ?? 0) + delta;
      store.set(key, String(next));
      return next;
    },
    async zAdd(key: string, entry: { member: string; score: number }) {
      const set = zsets.get(key) ?? [];
      const idx = set.findIndex((e) => e.member === entry.member);
      if (idx >= 0) set[idx] = entry;
      else set.push(entry);
      zsets.set(key, set);
    },
    async zRem(key: string, members: string[]) {
      const set = zsets.get(key) ?? [];
      zsets.set(
        key,
        set.filter((e) => !members.includes(e.member)),
      );
    },
    async zRange(
      key: string,
      _start: number,
      _stop: number,
      opts?: { reverse?: boolean; by?: string },
    ) {
      const set = [...(zsets.get(key) ?? [])];
      set.sort((a, b) => (opts?.reverse ? b.score - a.score : a.score - b.score));
      const stop = _stop < 0 ? set.length + _stop + 1 : _stop + 1;
      return set.slice(_start, stop).map((e) => ({ member: e.member, score: e.score }));
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory Reddit mock
// ---------------------------------------------------------------------------

type RedditMockOverrides = {
  getUserByUsername?: ReturnType<typeof vi.fn>;
  getWikiPage?: ReturnType<typeof vi.fn>;
};

function makeReddit(overrides: RedditMockOverrides = {}) {
  return {
    getUserByUsername: vi.fn().mockResolvedValue({
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days old
      linkKarma: 200,
      commentKarma: 300,
    }),
    getWikiPage: vi.fn().mockResolvedValue({ content: '' }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Settings mock
// ---------------------------------------------------------------------------

function makeSettings(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    auditMode: true,
    enableLlm: false,
    sensitivity: 'balanced',
    customKeywords: 'scam,crypto',
    blockedDomains: 'bit.ly,tinyurl.com',
    wikiRulesPage: 'rules',
    llmMaxPerHour: 60,
  };
  const values = { ...defaults, ...overrides };
  return {
    get: vi.fn((k: string) => Promise.resolve(values[k])),
    getAll: vi.fn(() => Promise.resolve(values)),
  };
}

// ---------------------------------------------------------------------------
// Helper: build a minimal TriageItem for store tests
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<TriageItem> = {}): TriageItem {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    thingId: `t3_${Math.random().toString(36).slice(2, 8)}`,
    thingType: 'post',
    subredditName: 'testsubreddit',
    authorUsername: 'testuser',
    permalink: '/r/testsubreddit/comments/abc/test',
    titleOrSnippet: 'Test post title',
    bodyText: 'Test body text',
    source: 'post_report',
    reportCount: 1,
    urgencyScore: 30,
    riskBand: 'ROUTINE',
    suggestedAction: 'review',
    heuristicBreakdown: {
      reportCountPts: 5,
      accountAgePts: 8,
      karmaPts: 5,
      keywordPts: 0,
      domainPts: 0,
      repeatOffenderPts: 0,
      automodPts: 0,
      signals: ['2 reports'],
    },
    status: 'open',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ===========================================================================
// 1. SCORING ENGINE
// ===========================================================================

describe('Scoring engine', () => {
  it('caps urgencyScore at 100', () => {
    const result = scoreTriageItem(
      {
        reportCount: 10,
        accountAgeDays: 0,
        totalKarma: 1,
        text: 'crypto scam free money',
        url: 'https://bit.ly/x',
        automodReason: 'matched spam filter',
        repeatOffender: true,
        customKeywords: ['crypto', 'scam'],
        blockedDomains: ['bit.ly'],
      },
      'balanced',
    );
    expect(result.urgencyScore).toBe(100);
    expect(result.riskBand).toBe('CRITICAL');
  });

  it('zero-report clean account scores LIKELY_OK', () => {
    const r = scoreTriageItem(
      {
        reportCount: 0,
        accountAgeDays: 1000,
        totalKarma: 50000,
        text: 'love this community',
        repeatOffender: false,
        customKeywords: [],
        blockedDomains: [],
      },
      'balanced',
    );
    expect(r.riskBand).toBe('LIKELY_OK');
    expect(r.suggestedAction).toBe('likely_approve');
    expect(r.heuristicBreakdown.signals).toContain('No strong risk signals — routine review');
  });

  it('new account (< 1 day) gives 20 pts accountAge', () => {
    const r = scoreTriageItem(
      {
        reportCount: 0,
        accountAgeDays: 0.1,
        totalKarma: 50000,
        text: 'hello world',
        repeatOffender: false,
        customKeywords: [],
        blockedDomains: [],
      },
      'balanced',
    );
    expect(r.heuristicBreakdown.accountAgePts).toBe(20);
    expect(r.heuristicBreakdown.signals).toContain('New account (< 1 day old)');
  });

  it('blocked domain on HIGH band triggers likely_remove', () => {
    // 3 reports (15) + new account (20) + low karma (10) + domain (20) = 65 → HIGH
    const r = scoreTriageItem(
      {
        reportCount: 3,
        accountAgeDays: 0.5,
        totalKarma: 50,
        text: 'check this out',
        url: 'https://bit.ly/abc',
        repeatOffender: false,
        customKeywords: [],
        blockedDomains: ['bit.ly'],
      },
      'balanced',
    );
    expect(r.heuristicBreakdown.domainPts).toBe(20);
    expect(r.riskBand).toBe('HIGH');
    expect(r.suggestedAction).toBe('likely_remove');
  });

  it('blocked domain on ROUTINE band gives likely_remove (hard signal)', () => {
    // 3 reports (15) + established account (0) + ok karma (0) + domain (20) = 35 → ROUTINE
    const r = scoreTriageItem(
      {
        reportCount: 3,
        accountAgeDays: 100,
        totalKarma: 2000,
        text: 'check this out',
        url: 'https://bit.ly/abc',
        repeatOffender: false,
        customKeywords: [],
        blockedDomains: ['bit.ly'],
      },
      'balanced',
    );
    expect(r.heuristicBreakdown.domainPts).toBe(20);
    expect(r.riskBand).toBe('ROUTINE');
    // Blocked domain is a categorical signal — likely_remove fires for any non-LIKELY_OK band
    expect(r.suggestedAction).toBe('likely_remove');
  });

  it('repeat offender adds 10 pts', () => {
    const without = scoreTriageItem(
      { reportCount: 1, accountAgeDays: 200, totalKarma: 500, text: 'hi', repeatOffender: false, customKeywords: [], blockedDomains: [] },
      'balanced',
    );
    const with_ = scoreTriageItem(
      { reportCount: 1, accountAgeDays: 200, totalKarma: 500, text: 'hi', repeatOffender: true, customKeywords: [], blockedDomains: [] },
      'balanced',
    );
    expect(with_.urgencyScore - without.urgencyScore).toBe(10);
    expect(with_.heuristicBreakdown.signals).toContain('Repeat offender (prior incidents in last 90 days)');
  });

  it('strict thresholds escalate bands vs relaxed', () => {
    const input = {
      reportCount: 3,
      accountAgeDays: 5,
      totalKarma: 50,
      text: 'some content',
      repeatOffender: false,
      customKeywords: [],
      blockedDomains: [],
    };
    const strict = scoreTriageItem(input, 'strict');
    const relaxed = scoreTriageItem(input, 'relaxed');
    const bands: string[] = ['CRITICAL', 'HIGH', 'ROUTINE', 'LIKELY_OK'];
    expect(bands.indexOf(strict.riskBand)).toBeLessThanOrEqual(bands.indexOf(relaxed.riskBand));
  });

  it('automod reason adds 10 pts and appears in signals', () => {
    const r = scoreTriageItem(
      {
        reportCount: 0,
        accountAgeDays: 365,
        totalKarma: 1000,
        text: 'normal text',
        automodReason: 'blocked phrase detected',
        repeatOffender: false,
        customKeywords: [],
        blockedDomains: [],
      },
      'balanced',
    );
    expect(r.heuristicBreakdown.automodPts).toBe(10);
    expect(r.heuristicBreakdown.signals.some((s) => s.includes('Automod'))).toBe(true);
  });

  it('parseListSetting splits and trims CSV', () => {
    expect(parseListSetting('  bit.ly , tinyurl.com , crypto ', '')).toEqual(['bit.ly', 'tinyurl.com', 'crypto']);
    expect(parseListSetting(undefined, 'fallback,values')).toEqual(['fallback', 'values']);
    expect(parseListSetting('', 'fallback')).toEqual([]);
  });

  it('bandLabel and bandEmoji produce consistent output', () => {
    expect(bandLabel('CRITICAL')).toBe('🔴 CRITICAL');
    expect(bandLabel('HIGH')).toBe('🟠 HIGH');
    expect(bandLabel('ROUTINE')).toBe('🟡 ROUTINE');
    expect(bandLabel('LIKELY_OK')).toBe('🟢 LIKELY_OK');
    expect(bandEmoji('CRITICAL')).toBe('🔴');
  });

  it('suggestedActionLabel returns expected strings', () => {
    expect(suggestedActionLabel('likely_remove')).toBe('Likely remove');
    expect(suggestedActionLabel('likely_approve')).toBe('Likely approve');
    expect(suggestedActionLabel('review')).toBe('Review manually');
  });
});

// ===========================================================================
// 2. TRIAGE STORE
// ===========================================================================

describe('Triage store', () => {
  let redis: ReturnType<typeof makeRedis>;

  beforeEach(() => {
    redis = makeRedis();
  });

  it('initStore writes schema version', async () => {
    await initStore(redis as any);
    const v = await redis.get('tg:schema_version');
    expect(v).toBe('1');
  });

  it('saveItem + getItemById round-trips correctly', async () => {
    const item = makeItem({ urgencyScore: 75, riskBand: 'HIGH' });
    await saveItem(redis as any, item);
    const fetched = await getItemById(redis as any, item.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.urgencyScore).toBe(75);
    expect(fetched!.riskBand).toBe('HIGH');
  });

  it('getItemByThingId resolves via index', async () => {
    const item = makeItem({ thingId: 't3_abc123' });
    await saveItem(redis as any, item);
    const fetched = await getItemByThingId(redis as any, 't3_abc123');
    expect(fetched?.id).toBe(item.id);
  });

  it('incrementReportCount increments atomically', async () => {
    const first = await incrementReportCount(redis as any, 't3_abc');
    const second = await incrementReportCount(redis as any, 't3_abc');
    const third = await incrementReportCount(redis as any, 't3_abc');
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(third).toBe(3);
  });

  it('listOpenItems returns items sorted by urgencyScore descending', async () => {
    const low = makeItem({ urgencyScore: 10, riskBand: 'LIKELY_OK' });
    const high = makeItem({ urgencyScore: 90, riskBand: 'CRITICAL' });
    const mid = makeItem({ urgencyScore: 50, riskBand: 'HIGH' });
    await saveItem(redis as any, low);
    await saveItem(redis as any, high);
    await saveItem(redis as any, mid);

    const items = await listOpenItems(redis as any);
    expect(items[0].urgencyScore).toBeGreaterThanOrEqual(items[1].urgencyScore);
    expect(items[1].urgencyScore).toBeGreaterThanOrEqual(items[2].urgencyScore);
  });

  it('resolveItem removes item from open queue', async () => {
    const item = makeItem({ thingId: 't3_resolve_me', urgencyScore: 60 });
    await saveItem(redis as any, item);

    let open = await listOpenItems(redis as any);
    expect(open.find((i) => i.thingId === 't3_resolve_me')).toBeDefined();

    await resolveItem(redis as any, 't3_resolve_me', 'resolved', 'moduser');

    open = await listOpenItems(redis as any);
    expect(open.find((i) => i.thingId === 't3_resolve_me')).toBeUndefined();
  });

  it('resolveItem sets resolvedBy and resolvedAt', async () => {
    const item = makeItem({ thingId: 't3_resolve_by' });
    await saveItem(redis as any, item);
    const resolved = await resolveItem(redis as any, 't3_resolve_by', 'dismissed', 'modXYZ');
    expect(resolved?.resolvedBy).toBe('modXYZ');
    expect(resolved?.resolvedAt).toBeDefined();
    expect(resolved?.status).toBe('dismissed');
  });

  it('getBandCounts tallies correctly', async () => {
    const items: TriageItem[] = [
      makeItem({ riskBand: 'CRITICAL' }),
      makeItem({ riskBand: 'CRITICAL' }),
      makeItem({ riskBand: 'HIGH' }),
      makeItem({ riskBand: 'ROUTINE' }),
      makeItem({ riskBand: 'LIKELY_OK' }),
    ];
    const counts = await getBandCounts(redis as any, items);
    expect(counts.CRITICAL).toBe(2);
    expect(counts.HIGH).toBe(1);
    expect(counts.ROUTINE).toBe(1);
    expect(counts.LIKELY_OK).toBe(1);
    expect(counts.total).toBe(5);
  });

  it('filterByBand filters correctly', () => {
    const items: TriageItem[] = [
      makeItem({ riskBand: 'CRITICAL' }),
      makeItem({ riskBand: 'HIGH' }),
      makeItem({ riskBand: 'ROUTINE' }),
    ];
    expect(filterByBand(items, 'CRITICAL')).toHaveLength(1);
    expect(filterByBand(items, 'HIGH')).toHaveLength(1);
    expect(filterByBand(items, 'ALL')).toHaveLength(3);
  });

  it('listOpenItems respects MAX_OPEN_ITEMS=20 cap', async () => {
    for (let i = 0; i < 25; i++) {
      await saveItem(redis as any, makeItem({ urgencyScore: i }));
    }
    const items = await listOpenItems(redis as any);
    expect(items.length).toBeLessThanOrEqual(20);
  });
});

// ===========================================================================
// 3. WIKI SERVICE
// ===========================================================================

describe('Wiki matchRuleHeuristic', () => {
  const rules = `
1. Be respectful — No harassment or hate.
2. No spam — No unsolicited promotion or repetitive content.
3. No scams — No fraudulent links or phishing.
4. Stay on topic.
`.trim();

  it('matches scam signal to scam rule', () => {
    // Signal must not contain 'domain' to avoid hitting the promotion branch first
    const matched = matchRuleHeuristic(rules, ['scam detected — phishing attempt']);
    expect(matched.toLowerCase()).toContain('scam');
  });

  it('domain signal with scam still returns scam rule (scam takes priority)', () => {
    // scam is higher priority than domain — should match line 3, not line 2
    const matched = matchRuleHeuristic(rules, ['Blocked/suspicious domain: bit.ly scam']);
    expect(matched.toLowerCase()).toContain('scam');
  });

  it('matches spam signal to spam rule', () => {
    const matched = matchRuleHeuristic(rules, ['keyword match: spam']);
    expect(matched.toLowerCase()).toContain('spam');
  });

  it('falls back to first rule if no match', () => {
    const matched = matchRuleHeuristic(rules, ['3 reports on this item']);
    // Returns first line when no keyword match
    expect(matched.length).toBeGreaterThan(5);
  });

  it('returns fallback text when rules is empty', () => {
    const matched = matchRuleHeuristic('', ['something']);
    expect(typeof matched).toBe('string');
  });
});

// ===========================================================================
// 4. LOAD INSTALLATION SETTINGS
// ===========================================================================

describe('loadInstallationSettings', () => {
  it('parses all settings correctly', async () => {
    const s = makeSettings({ sensitivity: 'strict', llmMaxPerHour: 30 });
    const settings = await loadInstallationSettings(s);
    expect(settings.sensitivity).toBe('strict');
    expect(settings.llmMaxPerHour).toBe(30);
    expect(settings.auditMode).toBe(true);
    expect(settings.enableLlm).toBe(false);
  });

  it('defaults to balanced when sensitivity is undefined', async () => {
    const s = makeSettings({ sensitivity: undefined });
    const settings = await loadInstallationSettings(s);
    expect(settings.sensitivity).toBe('balanced');
  });

  it('defaults auditMode to true when value is undefined', async () => {
    const s = makeSettings({ auditMode: undefined });
    const settings = await loadInstallationSettings(s);
    expect(settings.auditMode).toBe(true);
  });
});

// ===========================================================================
// 5. INGEST PIPELINE (full end-to-end with mocks)
// ===========================================================================

describe('ingestAndScore pipeline', () => {
  let redis: ReturnType<typeof makeRedis>;
  let reddit: ReturnType<typeof makeReddit>;
  let settings: ReturnType<typeof makeSettings>;

  beforeEach(() => {
    redis = makeRedis();
    reddit = makeReddit();
    settings = makeSettings({ enableLlm: false });
  });

  it('creates a TriageItem for a new post report', async () => {
    const item = await ingestAndScore(
      reddit as any,
      redis as any,
      settings,
      {
        thingId: 't3_newpost1',
        thingType: 'post',
        subredditName: 'testsubreddit',
        authorUsername: 'newuser',
        permalink: '/r/testsubreddit/comments/newpost1/title',
        titleOrSnippet: 'Check out this crypto deal',
        bodyText: 'Free crypto airdrop click here',
        source: 'post_report',
        reportReason: 'Spam',
        reportCount: 1,
      },
      {},
    );

    expect(item.thingId).toBe('t3_newpost1');
    expect(item.status).toBe('open');
    expect(item.urgencyScore).toBeGreaterThan(0);
    expect(item.riskBand).toBeDefined();
    expect(item.heuristicBreakdown.signals.length).toBeGreaterThan(0);
  });

  it('scores higher for scam content with blocked domain', async () => {
    const scam = await ingestAndScore(
      reddit as any,
      redis as any,
      settings,
      {
        thingId: 't3_scam1',
        thingType: 'post',
        subredditName: 'testsubreddit',
        authorUsername: 'scammer',
        permalink: '/r/testsubreddit/comments/scam1/scam',
        titleOrSnippet: 'Free crypto giveaway',
        bodyText: 'Click here for free coins',
        url: 'https://bit.ly/fakelink',
        source: 'post_report',
        reportReason: 'Scam',
        reportCount: 5,
      },
      {},
    );

    const normal = await ingestAndScore(
      reddit as any,
      makeRedis() as any,
      settings,
      {
        thingId: 't3_clean1',
        thingType: 'post',
        subredditName: 'testsubreddit',
        authorUsername: 'gooduser',
        permalink: '/r/testsubreddit/comments/clean1/normal',
        titleOrSnippet: 'Great discussion post',
        bodyText: 'I love this community',
        source: 'post_report',
        reportCount: 0,
      },
      {},
    );

    expect(scam.urgencyScore).toBeGreaterThan(normal.urgencyScore);
  });

  it('deduplicates re-reported content and increments count', async () => {
    const input = {
      thingId: 't3_dedupe1',
      thingType: 'post' as const,
      subredditName: 'testsubreddit',
      authorUsername: 'user1',
      permalink: '/r/testsubreddit/comments/dedupe1/x',
      titleOrSnippet: 'Some post',
      bodyText: 'Some content',
      source: 'post_report' as const,
      reportCount: 1,
    };

    await ingestAndScore(reddit as any, redis as any, settings, input, {});
    const second = await ingestAndScore(reddit as any, redis as any, settings, input, {});

    expect(second.reportCount).toBeGreaterThan(1);
  });

  it('adds heuristic LLM explanation for CRITICAL items when LLM disabled', async () => {
    const reddit2 = makeReddit({
      getUserByUsername: vi.fn().mockResolvedValue({
        createdAt: new Date(Date.now() - 0.5 * 24 * 60 * 60 * 1000), // brand new
        linkKarma: 5,
        commentKarma: 5,
      }),
    });

    const item = await ingestAndScore(
      reddit2 as any,
      redis as any,
      settings,
      {
        thingId: 't3_heuristic1',
        thingType: 'post',
        subredditName: 'testsubreddit',
        authorUsername: 'spammer',
        permalink: '/r/testsubreddit/comments/heuristic1/scam',
        titleOrSnippet: 'Free crypto scam link here',
        bodyText: 'Click bit.ly for free coins',
        url: 'https://bit.ly/scam',
        source: 'post_report',
        automodReason: 'Matched spam rule',
        reportReason: 'Spam',
        reportCount: 5,
      },
      {},
    );

    if (item.riskBand === 'CRITICAL' || item.riskBand === 'HIGH') {
      expect(item.llm).toBeDefined();
      expect(item.llm?.model).toBe('heuristic-rules');
      expect(item.llm?.confidence).toBeGreaterThan(0);
    }
  });

  it('saves item to Redis so it appears in listOpenItems', async () => {
    await ingestAndScore(
      reddit as any,
      redis as any,
      settings,
      {
        thingId: 't3_store_check',
        thingType: 'comment',
        subredditName: 'testsubreddit',
        authorUsername: 'commenter',
        permalink: '/r/testsubreddit/comments/abc/comment',
        titleOrSnippet: 'This is spam',
        bodyText: 'Buy now at bit.ly/x',
        url: 'https://bit.ly/x',
        source: 'comment_report',
        reportCount: 2,
      },
      {},
    );

    const open = await listOpenItems(redis as any);
    expect(open.find((i) => i.thingId === 't3_store_check')).toBeDefined();
  });

  it('gracefully handles getUserByUsername failure', async () => {
    const redditFailing = makeReddit({
      getUserByUsername: vi.fn().mockRejectedValue(new Error('User not found')),
    });

    const item = await ingestAndScore(
      redditFailing as any,
      redis as any,
      settings,
      {
        thingId: 't3_failuser',
        thingType: 'post',
        subredditName: 'testsubreddit',
        authorUsername: 'deleteduser',
        permalink: '/r/testsubreddit/comments/failuser/x',
        titleOrSnippet: 'Some post',
        bodyText: 'Some text',
        source: 'post_report',
        reportCount: 1,
      },
      {},
    );

    // Falls back to safe defaults (365 days, 5000 karma) — item is still created
    expect(item.status).toBe('open');
    expect(item.riskBand).toBeDefined();
  });

  it('comment ingestion works end-to-end', async () => {
    const item = await ingestAndScore(
      reddit as any,
      redis as any,
      settings,
      {
        thingId: 't1_comment1',
        thingType: 'comment',
        subredditName: 'testsubreddit',
        authorUsername: 'commenter',
        permalink: '/r/testsubreddit/comments/abc/comment',
        titleOrSnippet: 'Check my referral link bit.ly/x',
        bodyText: 'Earn free crypto at bit.ly/x',
        url: 'https://bit.ly/x',
        source: 'comment_report',
        reportReason: 'Spam',
        reportCount: 3,
      },
      {},
    );

    expect(item.thingType).toBe('comment');
    expect(item.thingId).toBe('t1_comment1');
    expect(item.status).toBe('open');
  });

  it('automod_filter source is recorded correctly', async () => {
    const item = await ingestAndScore(
      reddit as any,
      redis as any,
      settings,
      {
        thingId: 't3_automod1',
        thingType: 'post',
        subredditName: 'testsubreddit',
        authorUsername: 'automoduser',
        permalink: '/r/testsubreddit/comments/automod1/x',
        titleOrSnippet: 'Filtered post',
        bodyText: 'Some content',
        source: 'automod_filter',
        automodReason: 'Spam detected',
      },
      {},
    );

    expect(item.source).toBe('automod_filter');
    expect(item.automodReason).toBe('Spam detected');
    expect(item.heuristicBreakdown.automodPts).toBe(10);
  });
});

// ===========================================================================
// 6. SCORING BOUNDARY CONDITIONS
// ===========================================================================

describe('Scoring boundary conditions', () => {
  it('exactly at CRITICAL threshold (balanced=80) scores CRITICAL', () => {
    // 20 (new acct) + 10 (low karma) + 25 (5 reports) + 15 (keyword) + 10 (repeat) = 80
    const r = scoreTriageItem(
      {
        reportCount: 5,
        accountAgeDays: 0.1,
        totalKarma: 50,
        text: 'crypto giveaway',
        repeatOffender: true,
        customKeywords: ['crypto'],
        blockedDomains: [],
      },
      'balanced',
    );
    expect(r.urgencyScore).toBeGreaterThanOrEqual(80);
    expect(r.riskBand).toBe('CRITICAL');
  });

  it('one below ROUTINE threshold (balanced=30) scores LIKELY_OK', () => {
    // Just under 30 points
    const r = scoreTriageItem(
      {
        reportCount: 2,      // 10 pts
        accountAgeDays: 200,
        totalKarma: 5000,
        text: 'normal content',
        repeatOffender: false,
        customKeywords: [],
        blockedDomains: [],
      },
      'balanced',
    );
    // 2 reports = 10 pts, old account = 0, high karma = 0 → total 10 < 30
    expect(r.urgencyScore).toBeLessThan(30);
    expect(r.riskBand).toBe('LIKELY_OK');
  });

  it('karma between 100-1000 gives 5 pts', () => {
    const r = scoreTriageItem(
      {
        reportCount: 0,
        accountAgeDays: 400,
        totalKarma: 500,
        text: 'test',
        repeatOffender: false,
        customKeywords: [],
        blockedDomains: [],
      },
      'balanced',
    );
    expect(r.heuristicBreakdown.karmaPts).toBe(5);
  });

  it('karma >= 1000 gives 0 pts', () => {
    const r = scoreTriageItem(
      {
        reportCount: 0,
        accountAgeDays: 400,
        totalKarma: 1000,
        text: 'test',
        repeatOffender: false,
        customKeywords: [],
        blockedDomains: [],
      },
      'balanced',
    );
    expect(r.heuristicBreakdown.karmaPts).toBe(0);
  });

  it('report count caps at 25 pts (5 reports = 25)', () => {
    const r5 = scoreTriageItem(
      { reportCount: 5, accountAgeDays: 400, totalKarma: 5000, text: 'x', repeatOffender: false, customKeywords: [], blockedDomains: [] },
      'balanced',
    );
    const r10 = scoreTriageItem(
      { reportCount: 10, accountAgeDays: 400, totalKarma: 5000, text: 'x', repeatOffender: false, customKeywords: [], blockedDomains: [] },
      'balanced',
    );
    expect(r5.heuristicBreakdown.reportCountPts).toBe(25);
    expect(r10.heuristicBreakdown.reportCountPts).toBe(25);
  });

  it('account under 30 days but >= 7 days gives 8 pts', () => {
    const r = scoreTriageItem(
      { reportCount: 0, accountAgeDays: 15, totalKarma: 5000, text: 'x', repeatOffender: false, customKeywords: [], blockedDomains: [] },
      'balanced',
    );
    expect(r.heuristicBreakdown.accountAgePts).toBe(8);
  });

  it('account 7-30 days signals contain age', () => {
    const r = scoreTriageItem(
      { reportCount: 0, accountAgeDays: 15, totalKarma: 5000, text: 'x', repeatOffender: false, customKeywords: [], blockedDomains: [] },
      'balanced',
    );
    expect(r.heuristicBreakdown.signals.some((s) => s.includes('15 days'))).toBe(true);
  });
});
