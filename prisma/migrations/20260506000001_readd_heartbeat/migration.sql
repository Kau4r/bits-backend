-- CreateEnum
CREATE TYPE "public"."HeartbeatStatus" AS ENUM ('ONLINE', 'OFFLINE', 'IDLE');

-- CreateTable
CREATE TABLE "public"."ComputerHeartbeat" (
    "Heartbeat_ID" SERIAL NOT NULL,
    "Computer_ID" INTEGER NOT NULL,
    "User_ID" INTEGER,
    "Session_ID" TEXT NOT NULL,
    "Status" "public"."HeartbeatStatus" NOT NULL DEFAULT 'ONLINE',
    "IP_Address" TEXT,
    "Timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Interval_Used" INTEGER NOT NULL,
    "System_Info" JSONB,
    "Is_Active" BOOLEAN NOT NULL DEFAULT true,
    "Session_Start" TIMESTAMP(3) NOT NULL,
    "Session_End" TIMESTAMP(3),
    "Last_Activity" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComputerHeartbeat_pkey" PRIMARY KEY ("Heartbeat_ID")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComputerHeartbeat_Session_ID_key" ON "public"."ComputerHeartbeat"("Session_ID");

-- CreateIndex
CREATE INDEX "ComputerHeartbeat_Status_idx" ON "public"."ComputerHeartbeat"("Status");

-- CreateIndex
CREATE INDEX "ComputerHeartbeat_Session_ID_idx" ON "public"."ComputerHeartbeat"("Session_ID");

-- CreateIndex
CREATE INDEX "ComputerHeartbeat_Computer_ID_idx" ON "public"."ComputerHeartbeat"("Computer_ID");

-- CreateIndex
CREATE INDEX "ComputerHeartbeat_User_ID_idx" ON "public"."ComputerHeartbeat"("User_ID");

-- AddForeignKey
ALTER TABLE "public"."ComputerHeartbeat" ADD CONSTRAINT "ComputerHeartbeat_Computer_ID_fkey" FOREIGN KEY ("Computer_ID") REFERENCES "public"."Computer"("Computer_ID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ComputerHeartbeat" ADD CONSTRAINT "ComputerHeartbeat_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES "public"."User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;
