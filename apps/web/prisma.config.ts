import { defineConfig } from 'prisma/config';

const localDatabaseUrl = 'postgresql://warhammer:warhammer@localhost:5432/warhammer_simulator?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? localDatabaseUrl,
  },
});
