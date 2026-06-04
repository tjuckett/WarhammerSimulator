# Database

The app uses PostgreSQL for hosted practice saves.

## Local Development

Start the local database from the repo root:

```powershell
npm run docker:db
```

Apply migrations:

```powershell
npm run db:migrate
```

Regenerate Prisma Client after schema changes:

```powershell
npm run db:generate
```

Optional database browser:

```powershell
npm run db:studio
```

The local Docker database uses:

```txt
postgresql://warhammer:warhammer@localhost:5432/warhammer_simulator?schema=public
```

## Production

Use a managed PostgreSQL database and set `DATABASE_URL` in the deployed app
environment. Do not use the local Docker database in production.
