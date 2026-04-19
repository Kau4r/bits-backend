CREATE TYPE "FormDocumentType" AS ENUM (
  'INITIAL',
  'PURCHASE_ORDER',
  'DELIVERY_RECEIPT',
  'RECEIVING_REPORT',
  'SALES_INVOICE',
  'PROOF',
  'OTHER'
);

ALTER TABLE "Form"
  ADD COLUMN "Is_Received" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "Received_At" TIMESTAMP(3),
  ADD COLUMN "Received_By" INTEGER;

ALTER TABLE "FormAttachment"
  ADD COLUMN "Document_Type" "FormDocumentType" NOT NULL DEFAULT 'PROOF';

CREATE INDEX "Form_Received_By_idx" ON "Form"("Received_By");
CREATE INDEX "FormAttachment_Document_Type_idx" ON "FormAttachment"("Document_Type");

ALTER TABLE "Form"
  ADD CONSTRAINT "Form_Received_By_fkey"
  FOREIGN KEY ("Received_By") REFERENCES "User"("User_ID")
  ON DELETE SET NULL ON UPDATE CASCADE;
