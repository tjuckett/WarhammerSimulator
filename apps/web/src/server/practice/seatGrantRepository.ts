import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../db';

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issuePracticeSeatGrant(
  gameId: string,
  side: 0 | 1,
  playerId: string,
): Promise<{ playerId: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  await prisma.practiceSeatGrant.upsert({
    where: { gameId_side: { gameId, side } },
    create: { gameId, side, playerId, tokenHash: tokenHash(token) },
    update: { playerId, tokenHash: tokenHash(token) },
  });
  return { playerId, token };
}

export async function authenticatePracticeSeatGrant(
  gameId: string,
  side: 0 | 1,
  token: string,
): Promise<boolean> {
  const grant = await prisma.practiceSeatGrant.findUnique({
    where: { gameId_side: { gameId, side } },
    select: { tokenHash: true },
  });
  return grant?.tokenHash === tokenHash(token);
}
