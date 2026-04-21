-- CreateEnum
CREATE TYPE "FormHistoryAction" AS ENUM ('CREATED', 'APPROVED', 'REJECTED', 'TRANSFERRED', 'RETURNED', 'ARCHIVED', 'RECEIVED');

-- AlterTable
ALTER TABLE "FormHistory" ADD COLUMN     "Action" "FormHistoryAction" NOT NULL DEFAULT 'TRANSFERRED',
ADD COLUMN     "Performed_By" INTEGER,
ADD COLUMN     "Reason" TEXT;

-- CreateIndex
CREATE INDEX "FormHistory_Performed_By_idx" ON "FormHistory"("Performed_By");

-- AddForeignKey
ALTER TABLE "FormHistory" ADD CONSTRAINT "FormHistory_Performed_By_fkey" FOREIGN KEY ("Performed_By") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;
