export type RiskBand = 'CRITICAL' | 'HIGH' | 'ROUTINE' | 'LIKELY_OK';
export type ThingType = 'post' | 'comment';
export type TriageStatus = 'open' | 'resolved' | 'dismissed';
export type SuggestedAction = 'likely_remove' | 'likely_approve' | 'review';
export type TriageSource = 'post_report' | 'comment_report' | 'automod_filter' | 'manual';
export type Sensitivity = 'strict' | 'balanced' | 'relaxed';

export interface HeuristicBreakdown {
  reportCountPts: number;
  accountAgePts: number;
  karmaPts: number;
  keywordPts: number;
  domainPts: number;
  repeatOffenderPts: number;
  automodPts: number;
  signals: string[];
}

export interface LlmExplanation {
  category: string;
  matchedRule: string;
  oneLineWhy: string;
  confidence: number;
  model: string;
  classifiedAt: string;
}

export interface TriageItem {
  id: string;
  thingId: string;
  thingType: ThingType;
  subredditName: string;
  authorUsername: string;
  permalink: string;
  titleOrSnippet: string;
  bodyText: string;
  source: TriageSource;
  reportReason?: string;
  reportCount: number;
  automodReason?: string;
  urgencyScore: number;
  riskBand: RiskBand;
  suggestedAction: SuggestedAction;
  heuristicBreakdown: HeuristicBreakdown;
  llm?: LlmExplanation;
  status: TriageStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface AuthorRecord {
  username: string;
  reportsReceived: number;
  removalsByMods: number;
  lastIncidentAt: string;
}

export interface InstallationSettings {
  auditMode: boolean;
  enableLlm: boolean;
  sensitivity: Sensitivity;
  customKeywords: string;
  blockedDomains: string;
  wikiRulesPage: string;
  llmMaxPerHour: number;
}

export interface IngestInput {
  thingId: string;
  thingType: ThingType;
  subredditName: string;
  authorUsername: string;
  permalink: string;
  titleOrSnippet: string;
  bodyText: string;
  url?: string;
  source: TriageSource;
  reportReason?: string;
  reportCount?: number;
  automodReason?: string;
}

export interface BandCounts {
  CRITICAL: number;
  HIGH: number;
  ROUTINE: number;
  LIKELY_OK: number;
  total: number;
}
