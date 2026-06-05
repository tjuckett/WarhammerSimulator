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

The production deployment runs only the web app container. It expects your
existing PostgreSQL container to be reachable on the same Docker network.

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

3. Create `.env.production` from `.env.production.example` and set
   `DATABASE_URL` to your real PostgreSQL credentials. Use the PostgreSQL
   container name as the host:

```bash
DATABASE_URL="postgresql://warhammer:change-me@<postgres-container-name>:5432/warhammer_simulator?schema=public"
NEXT_PUBLIC_API_BASE_URL=""
DOCKER_NETWORK="warhammer-net"
```

4. Build and publish the app image:

```bash
docker login
docker buildx build --platform linux/amd64 -t timjuckett/warhammer-simulator:latest --push .
```

5. Apply production database migrations:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm web npm run db:migrate:deploy
```

6. Start the app:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

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

For a reverse proxy on the same Docker network, use
`warhammer-simulator:3000` as the upstream. If you keep the optional host port
mapping, LAN testing is available at `http://<unraid-ip>:3000`.

## GitHub Actions publishing

The workflow in `.github/workflows/build-test-publish.yml` runs on pull
requests and pushes to `main`.

Pull requests run dependency install, Prisma client generation, tests, the
Next production build, and a Docker image build without publishing.

Pushes to `main` run the same checks, then publish:

```text
timjuckett/warhammer-simulator:latest
timjuckett/warhammer-simulator:<commit-sha>
```

Add these repository secrets in GitHub before relying on publishing:

```text
DOCKERHUB_USERNAME=timjuckett
DOCKERHUB_TOKEN=<Docker Hub access token>
```
