# TriageGuard — Deployment Guide

## Prerequisites

| Requirement | Details |
|-------------|---------|
| Node.js | ≥ 22.2.0 |
| Devvit CLI | `npm install -g devvit` or use project `npx devvit` |
| Reddit account | Allowlisted for Devvit development |
| Test subreddit | You moderate; &lt; 200 subscribers for playtest |
| Groq API key | Optional; for LLM rule enrichment on Critical/High |


## 1. Initial setup

```bash
git clone <your-repo>
cd triageguard
npm install
npm run login          # opens browser — or: npx devvit login
```

Verify login:

```bash
npx devvit whoami
```

### Register the app on Reddit (required once)

Your local `devvit.json` is not enough — Reddit must know about the app before playtest, upload, or settings work.

```bash
npm run init           # or: npx devvit init
```

This opens [developers.reddit.com/new](https://developers.reddit.com/new) in your browser:

1. Sign in with the **same Reddit account** as `devvit login`
2. App name: **`triageguard`** (should be prefilled)
3. Complete the wizard — the CLI receives a code automatically (or paste it when prompted)

> If init says the app name is taken, pick a unique slug (e.g. `triageguard-demo`) — it will update `devvit.json`.

> **Note:** `devvit` is not installed globally by default. Always run it from the project folder via **`npx devvit …`** or **`npm run …`** (see `package.json` scripts). To install globally: `npm install -g devvit@0.12.21`.


## 2. Configure secrets (optional, after first upload)

Settings require at least one upload. **`npm run dev`** uploads automatically on first playtest, so run playtest first (section 3), then come back here.

App-scoped settings (shared across installations; you fund LLM for hackathon demo):

```bash
npx devvit settings set llmApiKey
# Paste Groq API key when prompted

npx devvit settings set llmModel
# Default: llama-3.1-8b-instant
```

List settings:

```bash
npx devvit settings list
```

Per-subreddit settings (moderators configure in App installation UI):

- `auditMode` — default `true`
- `enableLlm` — default `true`
- `sensitivity` — strict / balanced / relaxed
- `customKeywords`, `blockedDomains`, `wikiRulesPage`


## 3. Playtest (development)

```bash
npm run dev
```

This runs `npx devvit playtest` (via `npm run dev`):

1. Builds and uploads a private version  
2. Installs on your test subreddit  
3. Hot-reloads on save  

**First install:**

- Pinned post **TriageGuard — Mod Triage** is created  
- Subreddit menu: **TriageGuard: Open Dashboard**

**Verify:**

1. Report a test post from alt account  
2. Open dashboard → Refresh  
3. Expand **Show explain panel**  
4. On post ⋮ menu → **TriageGuard: Remove** → type `REMOVE`


## 4. Upload (private listing)

```bash
npm run upload
# or: npx devvit upload
```

Creates/updates your private app version on [developer.reddit.com](https://developers.reddit.com).

---

## 5. Publish (App Directory review)

Follow [Reddit launch guide](https://developers.reddit.com/docs/guides/launch/launch-guide).

### Privacy & Terms (required for HTTP apps)

TriageGuard uses the **HTTP** permission (Groq API). Reddit requires **Privacy Policy** and **Terms & Conditions** URLs before `publish`:

1. Host `docs/PRIVACY.md` and `docs/TERMS.md` at public URLs (e.g. push to GitHub and use the blob links).
2. Replace any remaining placeholders in those files (contact: u/Status-Carob5526).
3. Open [developer settings](https://developers.reddit.com/apps/triageguard/developer-settings) → add both links.
4. Run publish again:

```bash
npx devvit publish
```

Prepare listing assets:

| Asset | Requirement |
|-------|-------------|
| Icon | 1024×1024 PNG in `devvit.json` → `marketingAssets.icon` |
| Screenshots | **Explain panel** as hero (SRS NFR-8.2) |
| Description | Use primary positioning from README |
| Install steps | 3 bullets: install → open dashboard → report test |


## 6. Install on a production subreddit

After publish approval:

```bash
npx devvit install triageguard@latest --subreddit your_sub_name
```

Or install from App Directory UI as mod.


## 7. Operations

### View logs

```bash
npx devvit logs --subreddit your_sub_name
```

### Uninstall

```bash
npx devvit uninstall triageguard --subreddit your_sub_name
```

### Upgrade

Push new version via `npx devvit upload` / `publish`; mods upgrade from App Directory.


## Environment matrix

| Environment | Command | Audience |
|-------------|---------|----------|
| Local playtest | `npm run dev` | You + test sub |
| Private upload | `npx devvit upload` | App owner only |
| Published | `npx devvit publish` | Reviewed listing |
| Installed | App Directory | Subreddit mods |


## HTTP allowlist

Configured in `devvit.json`:

```json
"http": {
  "enable": true,
  "domains": ["api.groq.com"]
}
```

Add domains before calling other APIs.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Dashboard empty | Report/filter content after install; click Refresh |
| No LLM enrichment | `npx devvit settings set llmApiKey`; check `enableLlm` |
| Wiki rule generic | Set `wikiRulesPage`; ensure wiki page exists |
| Remove menu no-op | Run on post/comment; type `REMOVE` exactly |
| Playtest fails | `npx devvit login`; sub &lt; 200 subscribers |
| Type errors locally | `npm run typecheck` |
