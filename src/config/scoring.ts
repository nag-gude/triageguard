import type { HeuristicBreakdown, RiskBand, Sensitivity, SuggestedAction } from '../types.js';

export interface ScoringInput {
  reportCount: number;
  accountAgeDays: number;
  totalKarma: number;
  text: string;
  url?: string;
  automodReason?: string;
  repeatOffender: boolean;
  customKeywords: string[];
  blockedDomains: string[];
}

export interface ScoringResult {
  urgencyScore: number;
  riskBand: RiskBand;
  suggestedAction: SuggestedAction;
  heuristicBreakdown: HeuristicBreakdown;
}

const BAND_THRESHOLDS: Record<Sensitivity, { CRITICAL: number; HIGH: number; ROUTINE: number }> = {
  strict: { CRITICAL: 70, HIGH: 50, ROUTINE: 25 },
  balanced: { CRITICAL: 80, HIGH: 60, ROUTINE: 30 },
  relaxed: { CRITICAL: 90, HIGH: 70, ROUTINE: 40 },
};

export function scoreTriageItem(input: ScoringInput, sensitivity: Sensitivity = 'balanced'): ScoringResult {
  const signals: string[] = [];
  const lowerText = input.text.toLowerCase();

  const reportCountPts = Math.min(input.reportCount * 5, 25);
  if (input.reportCount >= 3) {
    signals.push(`${input.reportCount} reports on this item`);
  } else if (input.reportCount > 1) {
    signals.push(`${input.reportCount} reports`);
  }

  let accountAgePts = 0;
  if (input.accountAgeDays < 1) {
    accountAgePts = 20;
    signals.push('New account (< 1 day old)');
  } else if (input.accountAgeDays < 7) {
    accountAgePts = 15;
    signals.push(`Young account (${Math.floor(input.accountAgeDays)} days old)`);
  } else if (input.accountAgeDays < 30) {
    accountAgePts = 8;
    signals.push(`Account under 30 days (${Math.floor(input.accountAgeDays)} days)`);
  }

  let karmaPts = 0;
  if (input.totalKarma < 100) {
    karmaPts = 10;
    signals.push(`Low karma (${input.totalKarma})`);
  } else if (input.totalKarma < 1000) {
    karmaPts = 5;
  }

  let keywordPts = 0;
  for (const kw of input.customKeywords) {
    const k = kw.trim().toLowerCase();
    if (k && lowerText.includes(k)) {
      keywordPts = 15;
      signals.push(`Keyword match: "${kw.trim()}"`);
      break;
    }
  }

  let domainPts = 0;
  const urlLower = (input.url ?? lowerText).toLowerCase();
  for (const domain of input.blockedDomains) {
    const d = domain.trim().toLowerCase();
    if (d && urlLower.includes(d)) {
      domainPts = 20;
      signals.push(`Blocked/suspicious domain: ${domain.trim()}`);
      break;
    }
  }

  const repeatOffenderPts = input.repeatOffender ? 10 : 0;
  if (input.repeatOffender) {
    signals.push('Repeat offender (prior incidents in last 90 days)');
  }

  const automodPts = input.automodReason?.trim() ? 10 : 0;
  if (input.automodReason?.trim()) {
    signals.push(`Automod: ${input.automodReason.trim().slice(0, 80)}`);
  }

  const urgencyScore = Math.min(
    reportCountPts + accountAgePts + karmaPts + keywordPts + domainPts + repeatOffenderPts + automodPts,
    100,
  );

  const thresholds = BAND_THRESHOLDS[sensitivity];
  let riskBand: RiskBand = 'LIKELY_OK';
  if (urgencyScore >= thresholds.CRITICAL) riskBand = 'CRITICAL';
  else if (urgencyScore >= thresholds.HIGH) riskBand = 'HIGH';
  else if (urgencyScore >= thresholds.ROUTINE) riskBand = 'ROUTINE';

  const suggestedAction = deriveSuggestedAction(riskBand, domainPts, keywordPts, automodPts);

  if (signals.length === 0) {
    signals.push('No strong risk signals — routine review');
  }

  return {
    urgencyScore,
    riskBand,
    suggestedAction,
    heuristicBreakdown: {
      reportCountPts,
      accountAgePts,
      karmaPts,
      keywordPts,
      domainPts,
      repeatOffenderPts,
      automodPts,
      signals,
    },
  };
}

function deriveSuggestedAction(
  band: RiskBand,
  domainPts: number,
  keywordPts: number,
  automodPts: number,
): SuggestedAction {
  if (band === 'LIKELY_OK') return 'likely_approve';
  // Any non-LIKELY_OK item with a hard signal (blocked domain, keyword match, or
  // automod rule) warrants removal regardless of overall band — these signals are
  // categorical, not merely additive.
  if (domainPts > 0 || keywordPts > 0 || automodPts > 0) return 'likely_remove';
  return 'review';
}

export function parseListSetting(value: string | undefined, fallback: string): string[] {
  const raw = (value ?? fallback).split(',').map((s) => s.trim()).filter(Boolean);
  return raw;
}

export function bandEmoji(band: RiskBand): string {
  switch (band) {
    case 'CRITICAL':
      return '🔴';
    case 'HIGH':
      return '🟠';
    case 'ROUTINE':
      return '🟡';
    default:
      return '🟢';
  }
}

export function bandLabel(band: RiskBand): string {
  return `${bandEmoji(band)} ${band}`;
}

export function suggestedActionLabel(action: SuggestedAction): string {
  switch (action) {
    case 'likely_remove':
      return 'Likely remove';
    case 'likely_approve':
      return 'Likely approve';
    default:
      return 'Review manually';
  }
}
