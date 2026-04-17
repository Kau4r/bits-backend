-- Add normalized form attachments while preserving legacy Form.File_* fields.
CREATE TABLE "FormAttachment" (
    "Attachment_ID" SERIAL NOT NULL,
    "Form_ID" INTEGER NOT NULL,
    "Department" "FormDepartment" NOT NULL,
    "File_Name" TEXT NOT NULL,
    "File_Type" TEXT,
    "File_URL" TEXT NOT NULL,
    "Uploaded_By" INTEGER,
    "Uploaded_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Notes" TEXT,

    CONSTRAINT "FormAttachment_pkey" PRIMARY KEY ("Attachment_ID")
);

CREATE INDEX "FormAttachment_Form_ID_idx" ON "FormAttachment"("Form_ID");
CREATE INDEX "FormAttachment_Department_idx" ON "FormAttachment"("Department");
CREATE INDEX "FormAttachment_Uploaded_By_idx" ON "FormAttachment"("Uploaded_By");

ALTER TABLE "FormAttachment"
    ADD CONSTRAINT "FormAttachment_Form_ID_fkey"
    FOREIGN KEY ("Form_ID") REFERENCES "Form"("Form_ID") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FormAttachment"
    ADD CONSTRAINT "FormAttachment_Uploaded_By_fkey"
    FOREIGN KEY ("Uploaded_By") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "FormAttachment" (
    "Form_ID",
    "Department",
    "File_Name",
    "File_Type",
    "File_URL",
    "Uploaded_By",
    "Uploaded_At",
    "Notes"
)
SELECT
    "Form_ID",
    "Department",
    "File_Name",
    "File_Type",
    "File_URL",
    "Creator_ID",
    "Created_At",
    'Initial form attachment'
FROM "Form"
WHERE "File_URL" IS NOT NULL
  AND BTRIM("File_URL") <> ''
  AND "File_Name" IS NOT NULL
  AND BTRIM("File_Name") <> '';
