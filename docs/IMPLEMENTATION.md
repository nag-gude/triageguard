# TriageGuard — Implementation Guide

## Technology stack

| Layer | Choice |
|-------|--------|
| Platform | Devvit Blocks (`@devvit/public-api` 0.12.21) |
| Language | TypeScript (strict) |
| Storage | Devvit Redis (`tg:` key prefix) |
| LLM | Groq OpenAI-compatible API (`llama-3.1-8b-instant`) |
| Tests | Vitest (`tests/scoring.test.ts`) |

Manifest: [`devvit.json`](../devvit.json) — moderator Reddit scope, Redis, HTTP to `api.groq.com`.


## Code map

```
src/main.tsx
  ├── Devvit.configure(redis, redditAPI, http)
  ├── Devvit.addSettings(...)        # Installation + app secrets
  ├── Devvit.addTrigger(...)         # AppInstall + 4 ingest triggers
  ├── Devvit.addCustomPostType(...)  # Dashboard render
  └── Devvit.addMenuItem(...)        # Open dashboard, Approve, Remove

src/services/ingest.ts
  └── ingestAndScore()               # Main pipeline entry

src/config/scoring.ts
  └── scoreTriageItem()              # Pure functions — unit tested

src/services/triageStore.ts
  └── saveItem(), listOpenItems(), resolveItem()

src/ui/dashboard.tsx
  └── TriageDashboardRoot()          # Explain panel UI (Appendix C)
```


## Trigger handlers

| Event | Handler behavior |
|-------|------------------|
| `AppInstall` | Init Redis, cache wiki, create dashboard custom post, store post id |
| `PostReport` | `getPostById` → `ingestAndScore` |
| `CommentReport` | `getCommentById` → `ingestAndScore` |
| `AutomoderatorFilterPost` | Ingest with automod reason |
| `AutomoderatorFilterComment` | Ingest with automod reason |

Ingest errors are logged; triggers never throw to Reddit.


## Scoring engine

Implemented in `src/config/scoring.ts` — weights from SRS §10.1:

| Signal | Max points |
|--------|------------|
| Report count | 25 |
| Account age | 20 |
| Karma | 10 |
| Keyword hit | 15 |
| Blocked domain | 20 |
| Repeat offender | 10 |
| Automod reason | 10 |

Bands (balanced): Critical ≥80, High ≥60, Routine ≥30.

Run tests: `npm test`


## Rule enrichment

1. **Wiki cache** — `getWikiPage(sub, wikiRulesPage)` → Redis `tg:wiki:rules` (24h TTL logic via timestamp).
2. **Heuristic rule line** — `matchRuleHeuristic()` when LLM unavailable.
3. **Groq LLM** — Only if `enableLlm` + Critical/High + `llmApiKey` set + rate limit OK.

LLM prompt returns JSON: `category`, `matchedRule`, `oneLineWhy`, `confidence`.


## Dashboard (Blocks UI)

`TriageDashboardRoot` in `src/ui/dashboard.tsx`:

- **Mod gate** — compares current user to `getModerators()` list
- **Band counters** — 🔴 🟠 🟡 🟢
- **Filter tabs** — ALL / CRITICAL / HIGH / ROUTINE / LIKELY_OK
- **Row** — band, confidence/score, author, one-line why
- **Explain panel** — bulleted signals, matched rule quote, suggested action
- **Actions** — Open on Reddit (`navigateTo`), Dismiss (Redis only)
- **Approve/Remove** — via ⋮ menu on post/comment (not inline — Blocks limitation)

Color palette (UX):

| Token | Hex | Use |
|-------|-----|-----|
| Background | `#0f0f1a` | Page |
| Card | `#16213e` | Rows |
| Panel | `#1a1a2e` | Explain expand |
| Accent | `#4ECDC4` | Tagline, rules header |
| Critical | `#FF6B6B` | Band label |


## Menu actions

| Menu | Location | Behavior |
|------|----------|----------|
| TriageGuard: Open Dashboard | subreddit | Navigate to pinned dashboard post |
| TriageGuard: Approve | post, comment | Approve + resolve triage item |
| TriageGuard: Remove | post, comment | Show form → type `REMOVE` → remove + resolve |


## Settings

| Key | Scope | Default |
|-----|-------|---------|
| `auditMode` | Installation | `true` |
| `enableLlm` | Installation | `true` |
| `sensitivity` | Installation | `balanced` |
| `customKeywords` | Installation | `""` |
| `blockedDomains` | Installation | `bit.ly,tinyurl.com,crypto,...` |
| `wikiRulesPage` | Installation | `rules` |
| `llmMaxPerHour` | Installation | `60` |
| `llmApiKey` | App (secret) | — |
| `llmModel` | App | `llama-3.1-8b-instant` |

Set secrets:

```bash
devvit settings set llmApiKey
```


## Local development workflow

1. `npm run dev` — playtest with hot reload  
2. Create test post + report it on playtest sub  
3. Open dashboard → verify Critical item + explain panel  
4. Test menu Approve/Remove on that post  
5. `npm test` before submission