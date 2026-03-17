-- DropForeignKey
ALTER TABLE "public"."Borrow_Item" DROP CONSTRAINT "Borrow_Item_Item_ID_fkey";

-- AlterTable
ALTER TABLE "Borrow_Item" ADD COLUMN     "Purpose" TEXT,
ADD COLUMN     "Requested_Item_Type" TEXT,
ALTER COLUMN "Item_ID" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Borrow_Item" ADD CONSTRAINT "Borrow_Item_Item_ID_fkey" FOREIGN KEY ("Item_ID") REFERENCES "Item"("Item_ID") ON DELETE SET NULL ON UPDATE CASCADE;
