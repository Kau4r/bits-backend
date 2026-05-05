-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FormType" ADD VALUE 'RIS_E';
ALTER TYPE "FormType" ADD VALUE 'RIS_NE';

-- AlterTable
ALTER TABLE "Booked_Room" ADD COLUMN     "Original_Start" TIMESTAMP(3),
ADD COLUMN     "Series_ID" INTEGER;

-- AlterTable
ALTER TABLE "Item" DROP COLUMN "Location";

-- CreateTable
CREATE TABLE "Semester" (
    "Semester_ID" SERIAL NOT NULL,
    "Name" TEXT NOT NULL,
    "Start_Date" TIMESTAMP(3) NOT NULL,
    "End_Date" TIMESTAMP(3) NOT NULL,
    "Is_Active" BOOLEAN NOT NULL DEFAULT false,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Semester_pkey" PRIMARY KEY ("Semester_ID")
);

-- CreateTable
CREATE TABLE "Booking_Series" (
    "Series_ID" SERIAL NOT NULL,
    "Room_ID" INTEGER NOT NULL,
    "User_ID" INTEGER NOT NULL,
    "Title" TEXT NOT NULL,
    "Purpose" VARCHAR(500),
    "Notes" VARCHAR(500),
    "Recurrence_Rule" TEXT NOT NULL,
    "Anchor_Start" TIMESTAMP(3) NOT NULL,
    "Anchor_End" TIMESTAMP(3) NOT NULL,
    "Excluded_Dates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "Status" TEXT NOT NULL DEFAULT 'APPROVED',
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_Series_pkey" PRIMARY KEY ("Series_ID")
);

-- CreateIndex
CREATE INDEX "Semester_Is_Active_idx" ON "Semester"("Is_Active");

-- CreateIndex
CREATE INDEX "Semester_Start_Date_idx" ON "Semester"("Start_Date");

-- CreateIndex
CREATE INDEX "Booking_Series_Room_ID_idx" ON "Booking_Series"("Room_ID");

-- CreateIndex
CREATE INDEX "Booking_Series_User_ID_idx" ON "Booking_Series"("User_ID");

-- CreateIndex
CREATE INDEX "Booked_Room_Series_ID_Original_Start_idx" ON "Booked_Room"("Series_ID", "Original_Start");

-- AddForeignKey
ALTER TABLE "Booked_Room" ADD CONSTRAINT "Booked_Room_Series_ID_fkey" FOREIGN KEY ("Series_ID") REFERENCES "Booking_Series"("Series_ID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking_Series" ADD CONSTRAINT "Booking_Series_Room_ID_fkey" FOREIGN KEY ("Room_ID") REFERENCES "Room"("Room_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking_Series" ADD CONSTRAINT "Booking_Series_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES "User"("User_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

