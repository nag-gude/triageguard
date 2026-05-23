# TriageGuard — Architecture

## System context

```mermaid
flowchart TB
  subgraph Users
    M[Moderators]
    U[Community members]
  end

  subgraph RedditPlatform["Reddit"]
    R[Posts / Comments / Reports]
    MQ[Native mod queue]
    W[Subreddit wiki]
  end

  subgraph TriageGuard["TriageGuard (Devvit Blocks)"]
    direction TB
    TR[Event triggers]
    ING[Ingestion pipeline]
    SCR[Heuristic scorer]
    WIK[Rules service]
    LLM[Rule enricher - Groq]
    RS[(Redis per install)]
    DASH[Custom post dashboard]
    MENU[Mod menu actions]
    TR --> ING --> SCR --> RS
    SCR --> WIK
    SCR --> LLM
    WIK --> W
    LLM --> WIK
    RS --> DASH
    RS --> MENU
  end

  U -->|report| R
  R -->|events| TR
  M --> DASH
  M --> MENU
  MENU -->|approve / remove| R
  DASH -.->|deep link| R
  MQ -.->|not replaced| M
```

**Constraint:** Devvit cannot reorder Reddit’s native mod queue. TriageGuard is a **parallel prioritized work list** with explainability.



## Component architecture

```mermaid
flowchart LR
  subgraph Entry["Entry layer"]
    main[main.tsx]
    dash[dashboard.tsx]
  end

  subgraph Domain["Domain services"]
    ingest[ingest.ts]
    score[scoring.ts]
    store[triageStore.ts]
    wiki[wiki.ts]
    llm[llm.ts]
  end

  subgraph External["External"]
    redis[(Redis)]
    reddit[Reddit API]
    groq[Groq API]
  end

  main --> ingest
  main --> store
  dash --> store
  ingest --> score
  ingest --> wiki
  ingest --> llm
  ingest --> store
  store --> redis
  wiki --> reddit
  llm --> groq
  main --> reddit
```

| Component | File | Responsibility |
|-----------|------|----------------|
| **Entry** | `src/main.tsx` | Triggers, settings, menus, custom post type |
| **Dashboard UI** | `src/ui/dashboard.tsx` | Blocks JSX — bands, filters, explain panel |
| **Ingestion** | `src/services/ingest.ts` | Orchestrate score + enrich + persist |
| **Scoring** | `src/config/scoring.ts` | Pure heuristic engine (testable) |
| **Triage store** | `src/services/triageStore.ts` | Redis CRUD, sorted open queue |
| **Wiki** | `src/services/wiki.ts` | Fetch/cache rules, heuristic rule match |
| **LLM** | `src/services/llm.ts` | Groq classify + rate limit + cache |

---

## Data flow — ingest path

```mermaid
sequenceDiagram
  participant E as Reddit event
  participant T as Trigger handler
  participant I as ingestAndScore
  participant S as scoring.ts
  participant W as wiki.ts
  participant L as llm.ts
  participant R as Redis

  E->>T: PostReport / Automod filter
  T->>I: IngestInput
  I->>R: Dedupe / report count
  I->>S: Heuristic score + band
  S-->>I: urgencyScore, signals
  I->>W: getWikiRulesExcerpt
  alt Critical or High + enableLlm
    I->>L: classifyWithLlm
    L-->>I: matchedRule, oneLineWhy
  else No LLM
    I->>W: matchRuleHeuristic
  end
  I->>R: save TriageItem + zAdd open queue
```


## Data flow — moderator path

```mermaid
sequenceDiagram
  participant M as Moderator
  participant D as Dashboard
  participant R as Redis
  participant Menu as Menu action
  participant Reddit as Reddit API

  M->>D: Open custom post
  D->>R: listOpenItems (top 20)
  R-->>D: TriageItem[]
  M->>D: Expand explain panel
  alt Dismiss
    M->>D: Dismiss
    D->>R: status = dismissed
  else Act on content
    M->>Reddit: Open permalink
    M->>Menu: Approve or Remove
    Menu->>Reddit: approve() / remove()
    Menu->>R: status = resolved
  end
```


## Redis schema

| Key | Type | Purpose |
|-----|------|---------|
| `tg:schema_version` | string | Migration version |
| `tg:dashboard_post_id` | string | Pinned dashboard post |
| `tg:open` | sorted set | Item IDs by urgency score |
| `tg:item:{id}` | string (JSON) | Full `TriageItem` |
| `tg:thing:{thingId}` | string | thingId → item id |
| `tg:reportcount:{thingId}` | string | Report counter |
| `tg:wiki:rules` | string | Cached wiki excerpt |
| `tg:llm:{thingId}` | string | Cached LLM JSON |
| `tg:author:{user}` | hash | Repeat offender stats |



## Security & trust

```mermaid
flowchart TD
  A[auditMode default true] --> B[Remove requires form]
  B --> C[Type REMOVE to confirm]
  D[LLM never auto-acts] --> E[Mod clicks menu only]
  F[Mod-only dashboard] --> G[getModerators check]
  H[App-scoped Groq key] --> I[Subs do not supply keys in v1]
```



## Deployment topology

```mermaid
flowchart LR
  DEV[Developer machine] -->|devvit upload / playtest| REDDIT_HOST[Reddit Devvit runtime]
  REDDIT_HOST --> REDIS_INST[(Installation Redis)]
  REDDIT_HOST --> GROQ[api.groq.com]
```

All compute is **hosted by Reddit** — no external database or servers required for MVP.