-- CreateTable
CREATE TABLE "SavedArmy" (
    "id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "faction" TEXT NOT NULL,
    "units" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedArmy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedArmy_slot_key" ON "SavedArmy"("slot");

-- CreateIndex
CREATE INDEX "SavedArmy_updatedAt_idx" ON "SavedArmy"("updatedAt");
