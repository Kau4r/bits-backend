-- AlterTable
ALTER TABLE "Item_History" ADD COLUMN "Parent_Computer_ID" INTEGER;

-- CreateIndex
CREATE INDEX "Item_History_Parent_Computer_ID_Created_At_idx" ON "Item_History"("Parent_Computer_ID", "Created_At");

-- AddForeignKey
ALTER TABLE "Item_History" ADD CONSTRAINT "Item_History_Parent_Computer_ID_fkey" FOREIGN KEY ("Parent_Computer_ID") REFERENCES "Computer"("Computer_ID") ON DELETE SET NULL ON UPDATE CASCADE;
