import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const localDatabaseUrl = 'postgresql://warhammer:warhammer@localhost:5432/warhammer_simulator?schema=public';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function databaseUrl(): string {
  return process.env.DATABASE_URL ?? localDatabaseUrl;
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl() }),
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function checkDatabaseConnection(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
