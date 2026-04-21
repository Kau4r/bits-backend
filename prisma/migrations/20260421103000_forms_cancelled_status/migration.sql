-- Replace the Forms-only REJECTED status/action with CANCELLED.
-- Booking, borrowing, and ticket rejected states are intentionally unchanged.

ALTER TYPE "FormStatus" RENAME TO "FormStatus_old";
CREATE TYPE "FormStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'CANCELLED', 'ARCHIVED');

ALTER TABLE "Form"
  ALTER COLUMN "Status" DROP DEFAULT,
  ALTER COLUMN "Status" TYPE "FormStatus"
    USING (
      CASE
        WHEN "Status"::text = 'REJECTED' THEN 'CANCELLED'
        ELSE "Status"::text
      END
    )::"FormStatus",
  ALTER COLUMN "Status" SET DEFAULT 'PENDING';

DROP TYPE "FormStatus_old";

ALTER TYPE "FormHistoryAction" RENAME TO "FormHistoryAction_old";
CREATE TYPE "FormHistoryAction" AS ENUM ('CREATED', 'APPROVED', 'CANCELLED', 'TRANSFERRED', 'RETURNED', 'ARCHIVED', 'RECEIVED');

ALTER TABLE "FormHistory"
  ALTER COLUMN "Action" DROP DEFAULT,
  ALTER COLUMN "Action" TYPE "FormHistoryAction"
    USING (
      CASE
        WHEN "Action"::text = 'REJECTED' THEN 'CANCELLED'
        ELSE "Action"::text
      END
    )::"FormHistoryAction",
  ALTER COLUMN "Action" SET DEFAULT 'TRANSFERRED';

DROP TYPE "FormHistoryAction_old";
