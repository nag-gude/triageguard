import { useCallback, useEffect, useMemo, useState } from 'react';
import { DASHBOARD_TITLE } from '../config/constants.js';
import { bandLabel, suggestedActionLabel } from '../config/scoring.js';
import type { RiskBand, TriageItem } from '../types.js';

type FilterBand = RiskBand | 'ALL';

function formatAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function oneLineSummary(item: TriageItem): string {
  if (item.llm?.oneLineWhy) return item.llm.oneLineWhy;
  return item.heuristicBreakdown.signals[0] ?? 'Review item';
}

function confidenceLabel(item: TriageItem): string {
  if (item.llm?.model && item.llm.model !== 'heuristic-rules' && item.llm.confidence) {
    return `Confidence: ${Math.round(item.llm.confidence * 100)}%`;
  }
  return `Score: ${item.urgencyScore}/100`;
}

function ExplainPanel({ item, subredditName }: { item: TriageItem; subredditName: string }) {
  const matchedRule = item.llm?.matchedRule ?? 'No rule match — review manually';
  return (
    <div className="explain-panel">
      <h4 className="critical">Why prioritized</h4>
      <ul>
        {item.heuristicBreakdown.signals.map((signal, idx) => (
          <li key={`sig-${idx}`}>{signal}</li>
        ))}
      </ul>
      <h4 className="accent">Matched rule</h4>
      <p className="rule">&ldquo;{matchedRule}&rdquo;</p>
      <p className="wiki-hint">(from r/{subredditName} wiki)</p>
      <p className="suggested">
        Suggested action: {suggestedActionLabel(item.suggestedAction)} (mod confirms)
      </p>
    </div>
  );
}

export function App() {
  const [filter, setFilter] = useState<FilterBand>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<TriageItem[]>([]);
  const [subredditName, setSubredditName] = useState('subreddit');
  const [isModerator, setIsModerator] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    const res = await fetch('/api/triage/items');
    if (!res.ok) throw new Error('Failed to load triage queue');
    const data = (await res.json()) as { items: TriageItem[] };
    setItems(data.items);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const modRes = await fetch('/api/triage/mod-check');
      if (!modRes.ok) throw new Error('Failed to verify moderator access');
      const modData = (await modRes.json()) as { isModerator: boolean; subredditName: string };
      setIsModerator(modData.isModerator);
      setSubredditName(modData.subredditName || 'subreddit');
      if (modData.isModerator) {
        await loadQueue();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [loadQueue]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = useMemo(
    () => ({
      CRITICAL: items.filter((i) => i.riskBand === 'CRITICAL').length,
      HIGH: items.filter((i) => i.riskBand === 'HIGH').length,
      ROUTINE: items.filter((i) => i.riskBand === 'ROUTINE').length,
      LIKELY_OK: items.filter((i) => i.riskBand === 'LIKELY_OK').length,
      total: items.length,
    }),
    [items],
  );

  const filtered =
    filter === 'ALL' ? items : items.filter((i) => i.riskBand === filter);

  const dismiss = async (thingId: string) => {
    const res = await fetch('/api/triage/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thingId }),
    });
    if (!res.ok) return;
    await loadQueue();
  };

  if (loading) {
    return (
      <div className="centered">
        <h1>{DASHBOARD_TITLE}</h1>
        <p>Loading triage queue…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="centered">
        <h1>{DASHBOARD_TITLE}</h1>
        <p className="error">{error}</p>
        <button type="button" className="secondary" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  }

  if (!isModerator) {
    return (
      <div className="centered">
        <h1>Moderators only</h1>
        <p>
          This dashboard is for subreddit moderators. Install TriageGuard from the App Directory on a
          sub you moderate.
        </p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <h1>{DASHBOARD_TITLE}</h1>
      <p className="tagline">Queue intelligence for moderators — rule-aware triage</p>

      <div className="band-counts">
        <span>🔴 {counts.CRITICAL}</span>
        <span>🟠 {counts.HIGH}</span>
        <span>🟡 {counts.ROUTINE}</span>
        <span>🟢 {counts.LIKELY_OK}</span>
        <span className="muted">· {counts.total} open</span>
        <button type="button" className="secondary" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <div className="filters">
        {(['ALL', 'CRITICAL', 'HIGH', 'ROUTINE', 'LIKELY_OK'] as FilterBand[]).map((b) => (
          <button
            key={b}
            type="button"
            className={filter === b ? 'active' : ''}
            onClick={() => setFilter(b)}
          >
            {b === 'ALL' ? 'All' : b}
          </button>
        ))}
      </div>

      {counts.total === 0 ? (
        <div className="empty-card">
          <strong>No items in triage yet</strong>
          <p>Report content or use Automod to populate this dashboard.</p>
          <p className="hint">✓ Heuristics work with zero config</p>
          <p className="hint">✓ Set wiki rules page in installation settings</p>
          <p className="hint">✓ devvit settings set llmApiKey for rule enrichment</p>
        </div>
      ) : (
        filtered.map((item) => (
          <div key={item.id} className="triage-card">
            <div className="band">
              {bandLabel(item.riskBand)} · {confidenceLabel(item)}
            </div>
            <div className="meta">
              u/{item.authorUsername} · {item.thingType} · {formatAge(item.createdAt)} ·{' '}
              {item.reportCount} report{item.reportCount !== 1 ? 's' : ''}
            </div>
            <div className="title">{item.titleOrSnippet}</div>
            <div className="summary">{oneLineSummary(item)}</div>
            <div className="row-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
              >
                {expandedId === item.id ? 'Hide explain' : 'Show explain panel'}
              </button>
              <a className="primary link-button" href={item.permalink} target="_blank" rel="noopener noreferrer">
                Open on Reddit
              </a>
              <button type="button" className="destructive" onClick={() => void dismiss(item.thingId)}>
                Dismiss
              </button>
            </div>
            <p className="hint-text">
              Approve / Remove: ⋮ menu on the {item.thingType} → TriageGuard
            </p>
            {expandedId === item.id && <ExplainPanel item={item} subredditName={subredditName} />}
          </div>
        ))
      )}
    </div>
  );
}
