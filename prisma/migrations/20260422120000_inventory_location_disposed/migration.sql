ALTER TYPE "ItemStatus" ADD VALUE IF NOT EXISTS 'DISPOSED';

ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "Location" TEXT;

UPDATE "Item"
SET "Location" = "Room"."Name"
FROM "Room"
WHERE "Item"."Room_ID" = "Room"."Room_ID"
  AND "Item"."Location" IS NULL;
