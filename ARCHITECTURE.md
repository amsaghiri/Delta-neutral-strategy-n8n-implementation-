# Architecture (high level)

```mermaid
flowchart LR
  A[Cron every 2m] --> B[Assets Config (20 both-supported)]
  B --> C1[CB — Fetch Price (per asset)]
  B --> C2[KR — Funding (per asset)]
  C1 --> D1[Merge CB (wait)]
  C2 --> D2[Merge KR (wait)]
  D1 --> E[Barrier CB+KR]
  D2 --> E[Barrier CB+KR]
  E --> F[Assemble Snapshot]
  F --> G[Analyze & Advise]
  G --> H1[Escape — Report] --> I1[Telegram — Report]
  G --> H2[Escape — Health] --> I2[Telegram — Health]
  G --> H3[Escape — Health Prices] --> I3[Telegram — Health Prices]
  G --> J[Build Alert (if profitable)] --> I4[Telegram — Alert]
  G --> K[Rows → Items] --> L[Google Sheets — Append]
```
- **Analyze & Advise** computes: scenarios, auto-scan, freshness window, TTL, and builds HTML messages + rows.
- **Escape** nodes ensure HTML is safe in URLs/Telegram payloads.
- **HTTP Fallback** nodes can be removed if using Telegram credentials only.
