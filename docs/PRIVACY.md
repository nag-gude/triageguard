# TriageGuard Privacy Policy

**Last updated:** May 2026  
**App name:** TriageGuard  
**Contact:** [u/Status-Carob5526](https://www.reddit.com/user/Status-Carob5526) on Reddit.

## Overview

TriageGuard is a Reddit Devvit moderation tool. It helps subreddit moderators prioritize reported or filtered posts and comments. This policy describes what data the app processes and how it is used.

## Data we process

When installed on a subreddit, TriageGuard may process:

- **Report and moderation events** — posts/comments that are reported or caught by AutoModerator
- **Content snippets** — titles, bodies, URLs, and report reasons needed for triage scoring
- **Author usernames** — to score account-age/karma signals and track repeat-offender counts (stored in app Redis, not sold or shared)
- **Subreddit wiki rules** — cached excerpts used for rule matching in the explain panel
- **Moderator actions** — approve/remove actions taken via TriageGuard menu items (for queue state and audit)

TriageGuard runs on Reddit’s Devvit platform. Reddit’s own [Privacy Policy](https://www.reddit.com/policies/privacy-policy) applies to your Reddit account and platform data.

## Optional third-party service (Groq)

If the app owner configures a Groq API key, TriageGuard may send **limited text** (content snippets + wiki rules excerpt) to **api.groq.com** for optional rule enrichment on **Critical** and **High** priority items only. Heuristic scoring works without this feature.

- Groq’s privacy terms: [https://groq.com/privacy-policy](https://groq.com/privacy-policy)
- API keys are stored as Devvit app secrets, not exposed to end users.

## Data storage and retention

- Queue and scoring data are stored in **Devvit Redis** scoped to the installation.
- Resolved items are marked resolved in the queue; there is no separate external database.
- Wiki rules are cached temporarily (approximately 24 hours) to reduce API calls.

## What we do not do

- We do not sell user data.
- We do not use data for advertising.
- We do not collect passwords or payment information.
- We do not run tracking pixels or third-party analytics in the mod dashboard.

## Moderator responsibilities

Subreddit moderators control installation, app settings, and moderation actions. Moderators should only install TriageGuard on communities they moderate and should review the explain panel before taking action.

## Changes

This policy may be updated when the app changes. The “Last updated” date will be revised accordingly.

## Contact

Questions about this policy: contact the app owner via Reddit ([u/Status-Carob5526](https://www.reddit.com/user/Status-Carob5526)) or your project repository issues page.
