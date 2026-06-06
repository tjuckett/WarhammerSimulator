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

## Production deployment on Unraid

The production deployment runs the web app container and connects to your
existing Unraid PostgreSQL app/container.

Images are published to Docker Hub as `timjuckett/warhammer-simulator`.
Pushes to the `main` branch publish both `latest` and the commit SHA tag after
tests and the production build pass.

1. Create a shared Docker network on Unraid if one does not already exist:

```bash
docker network create warhammer-net
```

2. Attach your existing PostgreSQL container to that network:

```bash
docker network connect warhammer-net <postgres-container-name>
```

3. Create a database and user in PostgreSQL for the app, then create
   `.env.production` from `.env.production.example`. Use the PostgreSQL
   container name as the host:

```bash
DATABASE_URL="postgresql://warhammer:change-me@<postgres-container-name>:5432/warhammer_simulator?schema=public"
NEXT_PUBLIC_API_BASE_URL=""
DOCKER_NETWORK="warhammer-net"
SKIP_DB_MIGRATIONS="0"
```

4. Pull the published app image:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production pull
```

5. Start the app:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

The container applies pending Prisma migrations automatically at startup when
`DATABASE_URL` is set. Set `SKIP_DB_MIGRATIONS=1` only if you need to bypass
that behavior during troubleshooting.

The app listens on port `3000` inside the `warhammer-net` Docker network.
Point your reverse proxy to `warhammer-simulator-web:3000`, then verify the
deployment through `/api/practice/health`.

### Native Unraid Docker app

Use this path if you want the app to appear under Unraid's regular Docker tab
instead of using a Compose plugin.

Unraid Docker templates run an existing image; they do not build from a
Dockerfile. Publish the image to Docker Hub first:

```bash
docker login
docker buildx build --platform linux/amd64 -t timjuckett/warhammer-simulator:latest --push .
```

Copy the template to Unraid's user templates folder:

```bash
cp unraid/warhammer-simulator.xml /boot/config/plugins/dockerMan/templates-user/my-warhammer-simulator.xml
```

Then add it in the WebGUI:

1. Go to Docker.
2. Click Add Container.
3. Select `warhammer-simulator` from the Template dropdown.
4. Set `DATABASE_URL` with your PostgreSQL container name as the host.
5. Set Network Type to `warhammer-net` if Unraid does not preselect it.
6. Apply.

Run the production migration once before first use or after schema updates:

```bash
docker run --rm --network warhammer-net \
  -e DATABASE_URL="postgresql://warhammer:change-me@<postgres-container-name>:5432/warhammer_simulator?schema=public" \
  timjuckett/warhammer-simulator:latest \
  npm --workspace @warhammer-simulator/web run db:migrate:deploy
```

The normal app container also runs pending migrations automatically on startup.
The manual command above is useful for checking migration errors directly.

For a reverse proxy on the same Docker network, use
`warhammer-simulator:3000` as the upstream. If you keep the optional host port
mapping, LAN testing is available at `http://<unraid-ip>:3000`.

## GitHub Actions publishing

The workflow in `.github/workflows/build-test-publish.yml` runs separate
GitHub Actions jobs for tests, the app build, Docker image validation, and
publishing. Test and build run on every branch push and pull request.

Pull requests run:

```text
Test
Build
Docker Build
```

Pushes to `main` run:

```text
Test
Build
Publish
```

The publish job pushes:

```text
timjuckett/warhammer-simulator:latest
timjuckett/warhammer-simulator:<commit-sha>
```

Add these repository secrets in GitHub before relying on publishing:

```text
DOCKERHUB_USERNAME=timjuckett
DOCKERHUB_TOKEN=<Docker Hub access token>
```
