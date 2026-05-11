-- CreateTable
CREATE TABLE "Item_History" (
    "Item_History_ID" SERIAL NOT NULL,
    "Item_ID" INTEGER NOT NULL,
    "Action" TEXT NOT NULL,
    "Old_Value" JSONB,
    "New_Value" JSONB,
    "Performed_By_ID" INTEGER,
    "Reason" TEXT,
    "Notes" TEXT,
    "Parent_Item_ID" INTEGER,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_History_pkey" PRIMARY KEY ("Item_History_ID")
);

-- CreateIndex
CREATE INDEX "Item_History_Item_ID_Created_At_idx" ON "Item_History"("Item_ID", "Created_At");

-- CreateIndex
CREATE INDEX "Item_History_Parent_Item_ID_Created_At_idx" ON "Item_History"("Parent_Item_ID", "Created_At");

-- CreateIndex
CREATE INDEX "Item_History_Action_idx" ON "Item_History"("Action");

-- AddForeignKey
ALTER TABLE "Item_History" ADD CONSTRAINT "Item_History_Item_ID_fkey" FOREIGN KEY ("Item_ID") REFERENCES "Item"("Item_ID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item_History" ADD CONSTRAINT "Item_History_Parent_Item_ID_fkey" FOREIGN KEY ("Parent_Item_ID") REFERENCES "Item"("Item_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item_History" ADD CONSTRAINT "Item_History_Performed_By_ID_fkey" FOREIGN KEY ("Performed_By_ID") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;
