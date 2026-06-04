-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PracticeCheckpointKind" AS ENUM ('MANUAL', 'AUTO_PHASE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeGame" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "ruleset" JSONB NOT NULL,
    "setup" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeBranch" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "parentCheckpointId" TEXT,
    "name" TEXT,
    "initialState" JSONB NOT NULL,
    "timelineMetadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeCheckpoint" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "parentCheckpointId" TEXT,
    "kind" "PracticeCheckpointKind" NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timelineCursor" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeTimelineEntry" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "action" JSONB NOT NULL,
    "stateBefore" JSONB NOT NULL,
    "stateAfter" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeTimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "PracticeGame_ownerId_idx" ON "PracticeGame"("ownerId");

-- CreateIndex
CREATE INDEX "PracticeGame_updatedAt_idx" ON "PracticeGame"("updatedAt");

-- CreateIndex
CREATE INDEX "PracticeBranch_gameId_idx" ON "PracticeBranch"("gameId");

-- CreateIndex
CREATE INDEX "PracticeBranch_parentCheckpointId_idx" ON "PracticeBranch"("parentCheckpointId");

-- CreateIndex
CREATE INDEX "PracticeCheckpoint_gameId_sequence_idx" ON "PracticeCheckpoint"("gameId", "sequence");

-- CreateIndex
CREATE INDEX "PracticeCheckpoint_branchId_sequence_idx" ON "PracticeCheckpoint"("branchId", "sequence");

-- CreateIndex
CREATE INDEX "PracticeCheckpoint_parentCheckpointId_idx" ON "PracticeCheckpoint"("parentCheckpointId");

-- CreateIndex
CREATE INDEX "PracticeTimelineEntry_branchId_idx" ON "PracticeTimelineEntry"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeTimelineEntry_branchId_index_key" ON "PracticeTimelineEntry"("branchId", "index");

-- AddForeignKey
ALTER TABLE "PracticeGame" ADD CONSTRAINT "PracticeGame_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeBranch" ADD CONSTRAINT "PracticeBranch_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "PracticeGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeCheckpoint" ADD CONSTRAINT "PracticeCheckpoint_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "PracticeGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeCheckpoint" ADD CONSTRAINT "PracticeCheckpoint_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "PracticeBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeTimelineEntry" ADD CONSTRAINT "PracticeTimelineEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "PracticeBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
