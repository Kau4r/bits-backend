-- DropForeignKey
ALTER TABLE "public"."ComputerHeartbeat" DROP CONSTRAINT "ComputerHeartbeat_Computer_ID_fkey";

-- DropForeignKey
ALTER TABLE "public"."ComputerHeartbeat" DROP CONSTRAINT "ComputerHeartbeat_User_ID_fkey";

-- DropTable
DROP TABLE "public"."ComputerHeartbeat";

-- DropEnum
DROP TYPE "public"."HeartbeatStatus";

