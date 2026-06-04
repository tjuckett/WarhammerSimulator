# Warhammer Practice Table

## Local setup

Run these commands from the repository root.

```bash
npm install
npm run setup:local
npm run dev --workspace @warhammer-simulator/web
```

`npm run setup:local` starts the local Postgres container and applies the Prisma migration.

If the database is not running, the app still opens and practice saves fall back to browser storage. Start the database again with:

```bash
npm run docker:db
npm run db:migrate
```

To stop the local database container:

```bash
docker compose down
```
