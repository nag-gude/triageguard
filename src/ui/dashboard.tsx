import { Devvit, useAsync, useState } from '@devvit/public-api';
import { DASHBOARD_TITLE, MAX_OPEN_ITEMS } from '../config/constants.js';
import { bandLabel, suggestedActionLabel } from '../config/scoring.js';
import { filterByBand, listOpenItems, resolveItem } from '../services/triageStore.js';
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

function ExplainPanel(props: { item: TriageItem; subredditName: string }) {
  const { item, subredditName } = props;
  const matchedRule = item.llm?.matchedRule ?? 'No rule match — review manually';

  return (
    <vstack gap="small" width="100%" padding="small" backgroundColor="#1a1a2e" cornerRadius="small">
      <text size="small" weight="bold" color="#FF6B6B">
        Why prioritized
      </text>
      {item.heuristicBreakdown.signals.map((signal, idx) => (
        <text key={`sig-${idx}`} size="small" color="#E8E8E8" wrap>
          • {signal}
        </text>
      ))}
      <text size="small" weight="bold" color="#4ECDC4">
        Matched rule
      </text>
      <text size="small" color="#FFFFFF" wrap>
        "{matchedRule}"
      </text>
      <text size="xsmall" color="#888888">
        (from r/{subredditName} wiki)
      </text>
      <text size="small" color="#FFD93D">
        Suggested action: {suggestedActionLabel(item.suggestedAction)} (mod confirms)
      </text>
    </vstack>
  );
}

export function TriageDashboardRoot(context: Devvit.Context) {
  const [filter, setFilter] = useState<FilterBand>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const modCheck = useAsync(async () => {
    const username = await context.reddit.getCurrentUsername();
    const subName = context.subredditName;
    if (!username || !subName) return false;
    const sub = await context.reddit.getSubredditByName(subName);
    const mods = await sub.getModerators({ limit: 100 }).all();
    return mods.some((m) => m.username.toLowerCase() === username.toLowerCase());
  });

  const itemsRaw = useAsync(async () => {
    const list = await listOpenItems(context.redis, MAX_OPEN_ITEMS);
    return JSON.stringify(list);
  }, { depends: [version] });

  const allItems: TriageItem[] = itemsRaw.data ? (JSON.parse(String(itemsRaw.data)) as TriageItem[]) : [];

  if (modCheck.loading || itemsRaw.loading) {
    return (
      <vstack padding="large" alignment="center middle" gap="medium">
        <text size="xlarge" weight="bold" color="#FFFFFF">
          {DASHBOARD_TITLE}
        </text>
        <text color="#AAAAAA">Loading triage queue…</text>
      </vstack>
    );
  }

  if (!modCheck.data) {
    return (
      <vstack padding="large" alignment="center middle" gap="medium">
        <text size="xlarge" weight="bold">
          Moderators only
        </text>
        <text alignment="center" size="medium" color="#AAAAAA">
          This dashboard is for subreddit moderators. Install TriageGuard from the App Directory on a
          sub you moderate.
        </text>
      </vstack>
    );
  }

  const counts = {
    CRITICAL: allItems.filter((i) => i.riskBand === 'CRITICAL').length,
    HIGH: allItems.filter((i) => i.riskBand === 'HIGH').length,
    ROUTINE: allItems.filter((i) => i.riskBand === 'ROUTINE').length,
    LIKELY_OK: allItems.filter((i) => i.riskBand === 'LIKELY_OK').length,
    total: allItems.length,
  };
  const filtered = filterByBand(allItems, filter);
  const subName = context.subredditName ?? 'subreddit';

  return (
    <vstack gap="medium" padding="medium" width="100%" backgroundColor="#0f0f1a">
      <vstack gap="small">
        <text size="xlarge" weight="bold" color="#FFFFFF">
          {DASHBOARD_TITLE}
        </text>
        <text size="small" color="#4ECDC4">
          Queue intelligence for moderators — rule-aware triage
        </text>
      </vstack>

      <hstack gap="small">
        <text size="small" color="#FF6B6B">
          🔴 {counts.CRITICAL}
        </text>
        <text size="small" color="#FFA94D">
          🟠 {counts.HIGH}
        </text>
        <text size="small" color="#FFD93D">
          🟡 {counts.ROUTINE}
        </text>
        <text size="small" color="#6BCB77">
          🟢 {counts.LIKELY_OK}
        </text>
        <text size="small" color="#AAAAAA">
          · {counts.total} open
        </text>
        <button size="small" appearance="secondary" onPress={() => setVersion((v) => v + 1)}>
          Refresh
        </button>
      </hstack>

      <hstack gap="small">
        {(['ALL', 'CRITICAL', 'HIGH', 'ROUTINE', 'LIKELY_OK'] as FilterBand[]).map((b) => (
          <button
            key={b}
            size="small"
            appearance={filter === b ? 'primary' : 'secondary'}
            onPress={() => setFilter(b)}
          >
            {b === 'ALL' ? 'All' : b}
          </button>
        ))}
      </hstack>

      {counts.total === 0 ? (
        <vstack gap="small" padding="medium" backgroundColor="#16213e" cornerRadius="medium">
          <text weight="bold" color="#FFFFFF">
            No items in triage yet
          </text>
          <text size="small" color="#AAAAAA">
            Report content or use Automod to populate this dashboard.
          </text>
          <text size="small" color="#4ECDC4">
            ✓ Heuristics work with zero config
          </text>
          <text size="small" color="#4ECDC4">
            ✓ Set wiki rules page in installation settings
          </text>
          <text size="small" color="#4ECDC4">
            ✓ devvit settings set llmApiKey for rule enrichment
          </text>
        </vstack>
      ) : (
        <vstack gap="medium">
          {filtered.map((item) => (
            <vstack key={item.id} gap="small" padding="medium" backgroundColor="#16213e" cornerRadius="medium">
              <text weight="bold" color="#FFFFFF">
                {bandLabel(item.riskBand)} · {confidenceLabel(item)}
              </text>
              <text size="small" color="#AAAAAA">
                u/{item.authorUsername} · {item.thingType} · {formatAge(item.createdAt)} ·{' '}
                {item.reportCount} report{item.reportCount !== 1 ? 's' : ''}
              </text>
              <text weight="bold" wrap color="#FFFFFF">
                {item.titleOrSnippet}
              </text>
              <text size="small" color="#CCCCCC" wrap>
                {oneLineSummary(item)}
              </text>
              <hstack gap="small">
                <button
                  size="small"
                  appearance="secondary"
                  onPress={() => setExpandedId(expandedId === item.id ? null : item.id)}
                >
                  {expandedId === item.id ? 'Hide explain' : 'Show explain panel'}
                </button>
                <button
                  size="small"
                  appearance="primary"
                  onPress={() => context.ui.navigateTo(item.permalink)}
                >
                  Open on Reddit
                </button>
                <button
                  size="small"
                  appearance="destructive"
                  onPress={async () => {
                    await resolveItem(context.redis, item.thingId, 'dismissed');
                    setVersion((v) => v + 1);
                    context.ui.showToast({ text: 'Dismissed from triage', appearance: 'success' });
                  }}
                >
                  Dismiss
                </button>
              </hstack>
              <text size="xsmall" color="#888888">
                Approve / Remove: ⋮ menu on the {item.thingType} → TriageGuard
              </text>
              {expandedId === item.id && <ExplainPanel item={item} subredditName={subName} />}
            </vstack>
          ))}
        </vstack>
      )}
    </vstack>
  );
}
