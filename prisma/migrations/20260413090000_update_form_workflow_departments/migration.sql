-- Replace the legacy office-based FormDepartment enum with the workflow departments
-- used by the Forms UI. Existing old department values are intentionally reset
-- to REQUESTOR so they start at the beginning of the new workflow.

ALTER TABLE "Form" ALTER COLUMN "Department" DROP DEFAULT;

CREATE TYPE "FormDepartment_new" AS ENUM (
    'REQUESTOR',
    'DEPARTMENT_HEAD',
    'DEAN_OFFICE',
    'TNS',
    'PURCHASING',
    'PPFO',
    'COMPLETED'
);

ALTER TABLE "Form"
    ALTER COLUMN "Department" TYPE "FormDepartment_new"
    USING 'REQUESTOR'::"FormDepartment_new";

ALTER TABLE "FormHistory"
    ALTER COLUMN "Department" TYPE "FormDepartment_new"
    USING 'REQUESTOR'::"FormDepartment_new";

DROP TYPE "FormDepartment";
ALTER TYPE "FormDepartment_new" RENAME TO "FormDepartment";

ALTER TABLE "Form" ALTER COLUMN "Department" SET DEFAULT 'REQUESTOR';
ALTER TABLE "Form" ADD COLUMN "Requester_Name" TEXT;
ALTER TABLE "Form" ADD COLUMN "Remarks" TEXT;
