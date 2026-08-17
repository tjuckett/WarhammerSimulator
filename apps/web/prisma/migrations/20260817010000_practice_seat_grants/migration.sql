CREATE TABLE "PracticeSeatGrant" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "side" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeSeatGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PracticeSeatGrant_tokenHash_key" ON "PracticeSeatGrant"("tokenHash");
CREATE UNIQUE INDEX "PracticeSeatGrant_gameId_side_key" ON "PracticeSeatGrant"("gameId", "side");
CREATE INDEX "PracticeSeatGrant_gameId_playerId_idx" ON "PracticeSeatGrant"("gameId", "playerId");

ALTER TABLE "PracticeSeatGrant" ADD CONSTRAINT "PracticeSeatGrant_gameId_fkey"
  FOREIGN KEY ("gameId") REFERENCES "PracticeGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
