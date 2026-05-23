import { describe, expect, it } from 'vitest';
import { scoreTriageItem } from '../src/config/scoring.js';

describe('scoreTriageItem', () => {
  it('flags scam-like post as CRITICAL with balanced sensitivity', () => {
    const result = scoreTriageItem(
      {
        reportCount: 5,
        accountAgeDays: 0.5,
        totalKarma: 10,
        text: 'free crypto airdrop click here',
        url: 'https://bit.ly/scam-wallet',
        repeatOffender: false,
        customKeywords: ['crypto'],
        blockedDomains: ['bit.ly'],
      },
      'balanced',
    );
    expect(result.riskBand).toBe('CRITICAL');
    expect(result.urgencyScore).toBeGreaterThanOrEqual(80);
    expect(result.suggestedAction).toBe('likely_remove');
    expect(result.heuristicBreakdown.signals.length).toBeGreaterThan(0);
  });

  it('marks benign content as LIKELY_OK', () => {
    const result = scoreTriageItem(
      {
        reportCount: 0,
        accountAgeDays: 400,
        totalKarma: 5000,
        text: 'thanks for the helpful guide!',
        repeatOffender: false,
        customKeywords: [],
        blockedDomains: ['bit.ly'],
      },
      'balanced',
    );
    expect(result.riskBand).toBe('LIKELY_OK');
    expect(result.suggestedAction).toBe('likely_approve');
  });

  it('respects strict vs relaxed thresholds', () => {
    const input = {
      reportCount: 2,
      accountAgeDays: 5,
      totalKarma: 200,
      text: 'check this link',
      url: 'https://example.com',
      repeatOffender: false,
      customKeywords: [],
      blockedDomains: [],
    };
    const strict = scoreTriageItem(input, 'strict');
    const relaxed = scoreTriageItem(input, 'relaxed');
    const strictRank = ['CRITICAL', 'HIGH', 'ROUTINE', 'LIKELY_OK'].indexOf(strict.riskBand);
    const relaxedRank = ['CRITICAL', 'HIGH', 'ROUTINE', 'LIKELY_OK'].indexOf(relaxed.riskBand);
    expect(strictRank).toBeLessThanOrEqual(relaxedRank);
  });
});
