import { requestExpandedMode } from '@devvit/web/client';

type SummaryResponse = {
  isModerator: boolean;
  counts: {
    CRITICAL: number;
    HIGH: number;
    ROUTINE: number;
    LIKELY_OK: number;
    total: number;
  };
};

const statsEl = document.getElementById('stats');
const gateEl = document.getElementById('gate');
const openBtn = document.getElementById('open-dashboard') as HTMLButtonElement | null;

async function loadSummary(): Promise<void> {
  try {
    const res = await fetch('/api/triage/summary');
    if (!res.ok) throw new Error('summary failed');
    const data = (await res.json()) as SummaryResponse;

    if (!data.isModerator) {
      if (statsEl) statsEl.textContent = '';
      gateEl?.classList.remove('hidden');
      if (openBtn) openBtn.disabled = true;
      return;
    }

    gateEl?.classList.add('hidden');
    const { counts } = data;
    if (statsEl) {
      if (counts.total === 0) {
        statsEl.textContent = 'No open triage items — reports will appear here.';
      } else {
        statsEl.textContent = `🔴 ${counts.CRITICAL} · 🟠 ${counts.HIGH} · 🟡 ${counts.ROUTINE} · 🟢 ${counts.LIKELY_OK} · ${counts.total} open`;
      }
    }
    if (openBtn) openBtn.disabled = false;
  } catch {
    if (statsEl) statsEl.textContent = 'Could not load queue summary.';
    if (openBtn) openBtn.disabled = false;
  }
}

openBtn?.addEventListener('click', async (event) => {
  try {
    await requestExpandedMode(event, 'dashboard');
  } catch (e) {
    console.error('[TriageGuard] Failed to open dashboard', e);
  }
});

void loadSummary();
