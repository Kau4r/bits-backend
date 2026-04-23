-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('OPEN', 'NEAR_FULL', 'FULL');

-- AlterTable
ALTER TABLE "Booked_Room" ADD COLUMN "Queue_Status" "QueueStatus" NOT NULL DEFAULT 'OPEN';
