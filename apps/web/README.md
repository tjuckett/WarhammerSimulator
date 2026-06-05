# Web App

Next.js app for the Warhammer Practice Table.

Run from the repository root:

```bash
npm run setup:local
npm run dev --workspace @warhammer-simulator/web
```

Practice saves use Postgres when the database is available. If the database is down during local development, the app falls back to browser storage and shows that status in the Practice Timeline panel.
