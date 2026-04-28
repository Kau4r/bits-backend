-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "Last_Checked_At" TIMESTAMP(3),
ADD COLUMN     "Last_Checked_By_ID" INTEGER;

-- CreateIndex
CREATE INDEX "Item_Last_Checked_At_idx" ON "Item"("Last_Checked_At");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_Last_Checked_By_ID_fkey" FOREIGN KEY ("Last_Checked_By_ID") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;
