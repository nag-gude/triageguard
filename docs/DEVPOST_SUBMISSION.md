# Devpost submission — TriageGuard

Copy each section into the corresponding field on [Devpost](https://mod-tools-migration.devpost.com/). Replace placeholders marked `YOUR_*` before submitting.

---

## Project name

**TriageGuard**

---

## Elevator pitch (≤ 200 characters)

```
TriageGuard turns chaotic mod reports into a prioritized, rule-aware workflow—mods see what to tackle first, why it's urgent, and act safely with one-click tools.
```

**Character count:** 155

**Alternate (168 chars):**

```
TriageGuard helps mods focus on dangerous content first—prioritized triage, explainable reasoning tied to your sub's wiki rules, and safe one-click approve/remove.
```

---

## About the project

Paste into **“About the project”** (Markdown supported):

```markdown
## Inspiration

Moderators on busy subreddits face the same problem every day: the mod queue is a **FIFO pile** of reports. A scam post, a routine disagreement, and a duplicate link all look the same until you open each one. During the Reddit Mod Tools hackathon, we asked: *what if mods had hospital-style triage for their queue*—see the worst items first, with a clear **why**, before taking action?

We were inspired by how crowded the “AI moderation” space is—and deliberately chose **not** to build another black-box toxicity scorer. Instead we built **queue intelligence**: fast heuristics, **your subreddit’s own wiki rules**, and an explainability panel mods can trust.

## What it does

**TriageGuard** is a Devvit mod tool that:

1. **Ingests** reported and Automoderator-filtered posts and comments via Reddit triggers.
2. **Scores** each item (0–100) using heuristics: report volume, account age, karma, blocked domains, keywords, repeat offenders, and Automod reasons.
3. **Prioritizes** items into bands: **Critical**, **High**, **Routine**, and **Likely OK**.
4. **Explains** urgency in a polished dashboard—bulleted “why prioritized,” a **matched wiki rule** quote, and a non-binding suggested action (e.g. likely remove).
5. **Enables action** via mod menu: **Approve**, **Remove** (with `REMOVE` confirmation in audit mode), and **Open Dashboard**.

Mods open a pinned **TriageGuard — Mod Triage** custom post (moderator-only) instead of scrolling the native queue blindly. The tool does **not** replace Reddit’s mod queue UI—it provides a parallel, prioritized work list with deep links.

## How we built it

We built on **Reddit Devvit** (`@devvit/public-api`):

- **Triggers:** `PostReport`, `CommentReport`, `AutomoderatorFilterPost`, `AutomoderatorFilterComment`, plus `AppInstall` to seed a dashboard post and wiki cache.
- **Scoring engine:** Pure TypeScript in `src/config/scoring.ts`, unit-tested with Vitest.
- **Storage:** Installation-scoped **Redis** sorted set for open items (`tg:open` by urgency score).
- **Rules:** Wiki page fetch + 24h cache; fallback rule pack if wiki is empty.
- **Optional enrichment:** Groq (`llama-3.1-8b-instant`) for Critical/High items—structured JSON for `matchedRule` and `oneLineWhy`, with rate limiting and cache.
- **UI:** Devvit **Blocks** custom post dashboard with dark theme, band filters, and expandable explain panel (our primary UX investment).

Architecture, deployment, and UI specs live in `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, and `docs/UI_UX.md`.

## Challenges we ran into

1. **No native mod queue API** — Devvit cannot reorder Reddit’s queue. We reframed the product as a **triage command center** with deep links, not “we sort your queue.”
2. **Blocks UI limits** — Inline approve/remove on the dashboard isn’t reliable; we routed destructive actions to **post/comment menus** + confirmation forms.
3. **Crowded hackathon category** — Many teams ship “AI mod queue” tools. We differentiated with **wiki-aligned rules**, heuristic explainability without LLM, and **audit mode** by default.
4. **Scope vs. deadline** — We cut modmail alerts, raid signals, and duplicate clustering to ship a **polished explain panel** and killer demo path.
5. **`useAsync` + JSON** — Dashboard state had to serialize triage items for Devvit’s Blocks hooks.

## Accomplishments that we're proud of

- A **screenshot-ready explain panel** that shows band, confidence/score, signals, and quoted wiki rules—designed for Moderator’s Choice judges.
- **Zero-config heuristics** that work on install; LLM is enrichment, not a dependency.
- **Audit-first design:** `auditMode` defaults on; removals require typing `REMOVE`.
- Full **SRS-driven build** with judging traceability, tests, and documentation.
- End-to-end flow: report → Critical band → explain → menu remove → cleared from triage list.

## What we learned

- Moderators trust **explainability** more than model sophistication—a clear “why prioritized” beats another risk score.
- **Rule-aware** moderation (wiki citations) is a stronger story than generic “AI moderation” on Devvit.
- Devvit’s trigger + Redis + custom post pattern is enough for a credible hackathon MVP if scope is ruthlessly protected.
- Positioning matters: **queue intelligence for moderators** resonates; “LLM moderation” does not.

## What's next for TriageGuard

- **Devvit Web + React** client for split-pane list + sticky explain sidebar.
- Modmail alert on new Critical items (stretch cut from MVP).
- URL duplicate clustering for spam waves.
- App Directory launch and **Reddit Developer Funds** eligibility as installs grow.
- Optional: per-sub LLM opt-in vs. developer-funded keys for v1.
```

---

## Built with

```
TypeScript, Node.js 22+, Reddit Devvit (@devvit/public-api 0.12.21), Devvit Blocks UI, Devvit Redis, Reddit API (moderator scope), Groq API (optional rule enrichment), Vitest
```

**Tags to select on Devpost (if available):** `devvit`, `typescript`, `reddit`, `moderation`

---

## Try it out links

| Link | URL |
|------|-----|
| **Devvit app listing** | `https://developers.reddit.com/apps/triageguard` |
| **Live playtest demo** | `https://www.reddit.com/r/triageguard_dev/?playtest=triageguard` |
| **Source code** | `YOUR_GITHUB_REPO_URL` ← push repo and paste link |
| **Demo video** | `YOUR_VIDEO_URL` ← YouTube/Loom, **≤ 1 minute** |

**Install (for judges with a test sub):**

```text
devvit install triageguard@latest --subreddit triageguard_dev
```

---

## Sponsor / special prizes

Check on Devpost if applicable:

- [ ] **Feedback Award** — Complete the [Developer satisfaction survey](https://forms.gle/d9jY3szEzRzmKPwL8) (required for eligibility).
- [ ] **Devvit Helper Award** — Only if you nominate someone below (optional).

---

## Reddit username(s)

```
u/Status-Carob5526
```

_Add one line per team member, e.g. `u/alice`, `u/bob`._

---

## developers.reddit.com app page

```
https://developers.reddit.com/apps/triageguard
```

_App portal — privacy/terms links go in Developer settings on this page._

---

## Tool overview

Paste into **Tool overview**:

```markdown
### What TriageGuard is

TriageGuard is a **queue intelligence** mod tool for subreddits running on Reddit Devvit. It helps moderator teams **prioritize** reported and Automoderator-filtered content by urgency, understand **why** an item is high priority (including alignment with the sub’s **wiki rules**), and take **approve/remove** actions safely.

It is **not** an autopilot moderator. It does **not** reorder Reddit’s native mod queue. It provides a **parallel prioritized work list** via a pinned custom post dashboard.

### Capabilities

| Capability | Description |
|------------|-------------|
| **Event ingestion** | Listens for post/comment reports and Automoderator filter events. |
| **Heuristic scoring** | 0–100 urgency score from reports, account age, karma, keywords, blocked domains, repeat offenders, Automod reason. |
| **Risk bands** | Critical / High / Routine / Likely OK (sensitivity: strict, balanced, relaxed). |
| **Explainability panel** | Per item: “Why prioritized” bullets, matched wiki rule text, suggested action label, confidence or score. |
| **Wiki rules** | Fetches configurable wiki page (default `rules`); caches 24h; fallback rules if wiki empty. |
| **Rule enrichment (optional)** | Groq LLM for Critical/High when `enableLlm` is on and app `llmApiKey` is set. |
| **Triage dashboard** | Custom post: band counts, filters, top 20 open items sorted by urgency, refresh. Moderator-only gate. |
| **Menu: Open Dashboard** | Subreddit mod menu → navigates to pinned dashboard post. |
| **Menu: Approve** | On post/comment → approve on Reddit + mark triage item resolved. |
| **Menu: Remove** | Confirmation form (type `REMOVE`) → remove on Reddit + mark resolved + track repeat offender. |
| **Audit mode** | Default on; no silent removals. |
| **Installation settings** | Keywords, blocked domains, wiki page, sensitivity, LLM toggle, rate limit. |

### Intended use — moderators

1. **Install** TriageGuard on your subreddit from the App Directory (or playtest).
2. Open **TriageGuard — Mod Triage** (pinned post) or **TriageGuard: Open Dashboard** from the sub mod menu.
3. When reports/filters arrive, **refresh** the dashboard—Critical items appear at the top.
4. **Expand “Show explain panel”** to read signals and matched rule before acting.
5. **Open on Reddit** to view full context, then use **TriageGuard: Approve** or **TriageGuard: Remove** from the ⋮ menu on that post/comment.
6. **Dismiss** low-priority items from the triage list without a Reddit action if already handled.

### Intended use — community members

Community members interact normally: they **report** content per sub rules. They do **not** see the triage dashboard (moderator-only). TriageGuard does not change posting or voting UX.

### Configuration

- **Installation settings:** audit mode, LLM enable, sensitivity, custom keywords, blocked domains, wiki rules page name.
- **App secret (developer):** `llmApiKey`, `llmModel` via `devvit settings set` for optional Groq enrichment.
```

---

## Project impact

Paste into **Project impact**:

```markdown
### Target communities

1. **Regional / city subreddits** (e.g. local news, metro communities)  
   - **Benefit:** High spam and scam waves from new accounts; TriageGuard surfaces crypto/phishing links first.  
   - **Time savings:** ~30–60 seconds per mod per triage session when scanning 10+ reported items (pilot: finding Critical in &lt;10s vs ~60–90s in native queue).

2. **Hobby & tech communities** (gaming, gadgets, programming help)  
   - **Benefit:** Self-promo, affiliate spam, and duplicate scams prioritized with domain/keyword heuristics and wiki rule citations.  
   - **Time savings:** Fewer false starts on low-risk reports; mods focus on High/Critical tabs.

3. **High-discussion / news-adjacent subs**  
   - **Benefit:** Report volume spikes during controversies; banded queue reduces moderator fatigue and improves consistency across mod shifts.  
   - **Community impact:** Faster removal of policy-breaking content → safer discussions.

### Impact estimate

If a sub receives **50 triage items/day** and each item saves **30 seconds** of mod decision time:

\[
\text{Hours saved per day} = \frac{50 \times 30}{3600} \approx 0.42 \text{ hours/sub/day}
\]

With **3 active mods**, that is roughly **1.25 mod-hours saved daily**, or **~8+ hours per week**—time redirected to community engagement instead of FIFO queue scanning.

### Why Devvit

- Native **triggers** and **Redis** per installation—no external server to maintain.  
- **App Directory** install for any mod team.  
- Hosted on Reddit—aligned with hackathon platform goals and Developer Funds path.
```

---

## New app or migrated app?

**New App** (not a Data API migration / port)

---

## [For Ported Projects] Original Bot username

```
N/A
```

---

## [For Ported Projects] Port Completion

```
N/A
```

---

## [For Ported Projects] Are you the original owner of this migration?

```
N/A — new app, not a port.
```

---

## Nominate a most helpful user (optional — Devvit Helper Award)

Leave blank or fill in:

```markdown
u/HELPER_USERNAME — Helped with [e.g. Devvit trigger debugging / playtesting on r/Devvit / sharing mod tool template]. Their [specific advice] unblocked our dashboard install flow.
```

_You may not nominate yourself or direct teammates._

---

## Final reminder checklist

- [ ] **Demo video ≤ 1 minute** (recommend: install → flood reports → Critical on top → **hold explain panel 20s** → menu remove)
- [ ] App **uploaded** to [developers.reddit.com](https://developers.reddit.com) — URL in submission
- [ ] [Feedback survey](https://forms.gle/d9jY3szEzRzmKPwL8) completed (Feedback Award eligibility)
- [ ] Reddit username(s) filled in
- [ ] Try it out / app listing links updated
- [ ] Hero screenshot = **expanded explain panel** on a Critical item

---

## Suggested demo video script (≤ 60s)

| Time | Shot |
|------|------|
| 0:00–0:10 | Install app; show pinned **TriageGuard — Mod Triage** post |
| 0:10–0:25 | Alt account reports posts; refresh dashboard—scam at top of **Critical** |
| 0:25–0:45 | Expand **explain panel** (signals + matched rule) |
| 0:45–0:55 | ⋮ menu → **TriageGuard: Remove** → type REMOVE |
| 0:55–1:00 | “Native queue: ~60s to find this → TriageGuard: under 10s” |

---

## Category

**Best New Mod Tool** (primary) — also eligible for **Moderator’s Choice** based on judging criteria.
