-- CreateTable
CREATE TABLE "Computer_Suggestion" (
    "Suggestion_ID" SERIAL NOT NULL,
    "Name" TEXT NOT NULL,
    "Item_Types" JSONB NOT NULL,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Computer_Suggestion_pkey" PRIMARY KEY ("Suggestion_ID")
);

-- CreateIndex
CREATE UNIQUE INDEX "Computer_Suggestion_Name_key" ON "Computer_Suggestion"("Name");
