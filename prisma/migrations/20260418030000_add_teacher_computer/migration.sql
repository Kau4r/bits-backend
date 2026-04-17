-- AlterTable
ALTER TABLE "Computer" ADD COLUMN "Is_Teacher" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Computer_Room_ID_Is_Teacher_idx" ON "Computer"("Room_ID", "Is_Teacher");
