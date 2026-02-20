warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).
For more information, see: https://pris.ly/prisma-config

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('HARDWARE', 'SOFTWARE', 'FACILITY', 'OTHER');

-- CreateEnum
CREATE TYPE "FormType" AS ENUM ('WRF', 'RIS');

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FormDepartment" AS ENUM ('REGISTRAR', 'FINANCE', 'DCISM', 'LABORATORY');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RESERVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('CLASS', 'FACULTY_USE', 'STUDENT_USE', 'MAINTENANCE', 'SPECIAL_EVENT');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('CONSULTATION', 'LECTURE', 'LAB');

-- CreateEnum
CREATE TYPE "LabType" AS ENUM ('WINDOWS', 'MAC');

-- CreateEnum
CREATE TYPE "LogType" AS ENUM ('TICKET', 'SCHEDULE', 'BORROWING', 'SYSTEM', 'AUTH', 'BOOKING', 'FORM', 'ROOM', 'INVENTORY', 'REPORT');

-- CreateEnum
CREATE TYPE "BorrowStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'BORROWED', 'RETURNED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('LAB_HEAD', 'LAB_TECH', 'FACULTY', 'STUDENT', 'SECRETARY', 'ADMIN');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('AVAILABLE', 'BORROWED', 'DEFECTIVE', 'LOST', 'REPLACED');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('HDMI', 'VGA', 'ADAPTER', 'PROJECTOR', 'EXTENSION', 'MOUSE', 'KEYBOARD', 'MONITOR', 'SYSTEM_UNIT', 'GENERAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ComputerStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "HeartbeatStatus" AS ENUM ('ONLINE', 'IDLE', 'OFFLINE', 'WARNING');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED');

-- CreateTable
CREATE TABLE "User" (
    "User_ID" SERIAL NOT NULL,
    "First_Name" TEXT NOT NULL,
    "Middle_Name" TEXT NOT NULL,
    "Last_Name" TEXT NOT NULL,
    "Email" TEXT NOT NULL,
    "Password" TEXT NOT NULL,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,
    "Is_Active" BOOLEAN NOT NULL DEFAULT true,
    "User_Role" "UserRole" NOT NULL DEFAULT 'STUDENT',

    CONSTRAINT "User_pkey" PRIMARY KEY ("User_ID")
);

-- CreateTable
CREATE TABLE "Item" (
    "Item_ID" SERIAL NOT NULL,
    "User_ID" INTEGER,
    "Item_Code" TEXT NOT NULL,
    "Item_Type" "ItemType" NOT NULL DEFAULT 'GENERAL',
    "Brand" TEXT,
    "Serial_Number" TEXT,
    "Status" "ItemStatus" NOT NULL,
    "Room_ID" INTEGER,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,
    "ReplacedById" INTEGER,
    "IsBorrowable" BOOLEAN,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("Item_ID")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "Ticket_ID" SERIAL NOT NULL,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,
    "Archived" BOOLEAN NOT NULL DEFAULT false,
    "Category" "TicketCategory",
    "Item_ID" INTEGER,
    "Location" TEXT,
    "Priority" "TicketPriority",
    "Report_Problem" TEXT NOT NULL,
    "Reported_By_ID" INTEGER NOT NULL,
    "Room_ID" INTEGER,
    "Technician_ID" INTEGER,
    "Status" "TicketStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("Ticket_ID")
);

-- CreateTable
CREATE TABLE "Form" (
    "Form_ID" SERIAL NOT NULL,
    "Creator_ID" INTEGER NOT NULL,
    "Approver_ID" INTEGER,
    "Title" TEXT,
    "Content" TEXT,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,
    "Department" "FormDepartment" NOT NULL DEFAULT 'REGISTRAR',
    "File_Name" TEXT,
    "File_Type" TEXT,
    "File_URL" TEXT,
    "Form_Code" TEXT NOT NULL,
    "Form_Type" "FormType" NOT NULL,
    "Is_Archived" BOOLEAN NOT NULL DEFAULT false,
    "Status" "FormStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Form_pkey" PRIMARY KEY ("Form_ID")
);

-- CreateTable
CREATE TABLE "FormHistory" (
    "History_ID" SERIAL NOT NULL,
    "Form_ID" INTEGER NOT NULL,
    "Department" "FormDepartment" NOT NULL,
    "Changed_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Notes" TEXT,

    CONSTRAINT "FormHistory_pkey" PRIMARY KEY ("History_ID")
);

-- CreateTable
CREATE TABLE "Room" (
    "Room_ID" SERIAL NOT NULL,
    "Name" TEXT NOT NULL,
    "Room_Type" "RoomType" NOT NULL DEFAULT 'LAB',
    "Lab_Type" "LabType",
    "Capacity" INTEGER NOT NULL,
    "Status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
    "Current_Use_Type" "ScheduleType",
    "Opened_By" INTEGER,
    "Opened_At" TIMESTAMP(3),
    "Closed_At" TIMESTAMP(3),
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("Room_ID")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "Schedule_ID" SERIAL NOT NULL,
    "Room_ID" INTEGER NOT NULL,
    "Schedule_Type" "ScheduleType" NOT NULL,
    "Title" TEXT NOT NULL,
    "Start_Time" TIMESTAMP(3) NOT NULL,
    "End_Time" TIMESTAMP(3) NOT NULL,
    "Days" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "IsActive" BOOLEAN NOT NULL DEFAULT true,
    "IsRecurring" BOOLEAN NOT NULL DEFAULT true,
    "Created_By" INTEGER NOT NULL,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("Schedule_ID")
);

-- CreateTable
CREATE TABLE "Booked_Room" (
    "Booked_Room_ID" SERIAL NOT NULL,
    "Room_ID" INTEGER NOT NULL,
    "User_ID" INTEGER NOT NULL,
    "Start_Time" TIMESTAMP(3) NOT NULL,
    "End_Time" TIMESTAMP(3) NOT NULL,
    "Status" TEXT NOT NULL DEFAULT 'PENDING',
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,
    "Purpose" TEXT,
    "Schedule_ID" INTEGER,
    "Approved_By" INTEGER,
    "Notes" TEXT,

    CONSTRAINT "Booked_Room_pkey" PRIMARY KEY ("Booked_Room_ID")
);

-- CreateTable
CREATE TABLE "Audit_Log" (
    "Log_ID" SERIAL NOT NULL,
    "User_ID" INTEGER,
    "Action" TEXT NOT NULL,
    "Timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Is_Notification" BOOLEAN NOT NULL DEFAULT false,
    "Log_Type" "LogType" NOT NULL DEFAULT 'SYSTEM',
    "Notification_Read_At" TIMESTAMP(3),
    "Ticket_ID" INTEGER,
    "Notification_Data" JSONB,
    "Notification_Type" TEXT,
    "Booked_Room_ID" INTEGER,
    "Details" TEXT,

    CONSTRAINT "Audit_Log_pkey" PRIMARY KEY ("Log_ID")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "Read_ID" SERIAL NOT NULL,
    "User_ID" INTEGER NOT NULL,
    "Log_ID" INTEGER NOT NULL,
    "Read_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("Read_ID")
);

-- CreateTable
CREATE TABLE "Borrow_Item" (
    "Borrow_Item_ID" SERIAL NOT NULL,
    "Item_ID" INTEGER NOT NULL,
    "Borrow_Date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Return_Date" TIMESTAMP(3),
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Borrowee_ID" INTEGER NOT NULL,
    "Borrower_ID" INTEGER NOT NULL,
    "Room_ID" INTEGER,
    "Status" "BorrowStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Borrow_Item_pkey" PRIMARY KEY ("Borrow_Item_ID")
);

-- CreateTable
CREATE TABLE "Borrowing_Comp" (
    "Borrowing_Comp_ID" SERIAL NOT NULL,
    "User_ID" INTEGER NOT NULL,
    "Computer_ID" INTEGER NOT NULL,
    "Return_Date" TIMESTAMP(3) NOT NULL,
    "Status" TEXT NOT NULL,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Borrowing_Comp_pkey" PRIMARY KEY ("Borrowing_Comp_ID")
);

-- CreateTable
CREATE TABLE "Computer" (
    "Computer_ID" SERIAL NOT NULL,
    "Name" TEXT NOT NULL,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,
    "Status" "ComputerStatus" NOT NULL DEFAULT 'AVAILABLE',
    "Room_ID" INTEGER,
    "Mac_Address" TEXT,
    "IP_Address" TEXT,
    "Last_Seen" TIMESTAMP(3),
    "Is_Online" BOOLEAN NOT NULL DEFAULT false,
    "Current_User_ID" INTEGER,

    CONSTRAINT "Computer_pkey" PRIMARY KEY ("Computer_ID")
);

-- CreateTable
CREATE TABLE "ComputerHeartbeat" (
    "Heartbeat_ID" SERIAL NOT NULL,
    "Computer_ID" INTEGER NOT NULL,
    "User_ID" INTEGER,
    "Session_ID" TEXT NOT NULL,
    "Status" "HeartbeatStatus" NOT NULL DEFAULT 'ONLINE',
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

-- CreateTable
CREATE TABLE "Weekly_Report" (
    "Report_ID" SERIAL NOT NULL,
    "User_ID" INTEGER NOT NULL,
    "Week_Start" TIMESTAMP(3) NOT NULL,
    "Week_End" TIMESTAMP(3) NOT NULL,
    "Tasks" JSONB NOT NULL,
    "Issues_Reported" INTEGER NOT NULL DEFAULT 0,
    "Notes" TEXT,
    "Status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "Reviewed_By" INTEGER,
    "Reviewed_At" TIMESTAMP(3),
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Weekly_Report_pkey" PRIMARY KEY ("Report_ID")
);

-- CreateTable
CREATE TABLE "_ComputerItems" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ComputerItems_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_Email_key" ON "User"("Email");

-- CreateIndex
CREATE UNIQUE INDEX "Item_Item_Code_key" ON "Item"("Item_Code");

-- CreateIndex
CREATE UNIQUE INDEX "Item_ReplacedById_key" ON "Item"("ReplacedById");

-- CreateIndex
CREATE INDEX "Item_Item_Code_idx" ON "Item"("Item_Code");

-- CreateIndex
CREATE INDEX "Item_Status_idx" ON "Item"("Status");

-- CreateIndex
CREATE INDEX "Item_Room_ID_idx" ON "Item"("Room_ID");

-- CreateIndex
CREATE UNIQUE INDEX "Form_Form_Code_key" ON "Form"("Form_Code");

-- CreateIndex
CREATE INDEX "Audit_Log_Log_Type_idx" ON "Audit_Log"("Log_Type");

-- CreateIndex
CREATE INDEX "Audit_Log_User_ID_idx" ON "Audit_Log"("User_ID");

-- CreateIndex
CREATE INDEX "Audit_Log_Ticket_ID_idx" ON "Audit_Log"("Ticket_ID");

-- CreateIndex
CREATE INDEX "Audit_Log_Booked_Room_ID_idx" ON "Audit_Log"("Booked_Room_ID");

-- CreateIndex
CREATE INDEX "Audit_Log_Is_Notification_User_ID_Notification_Read_At_idx" ON "Audit_Log"("Is_Notification", "User_ID", "Notification_Read_At");

-- CreateIndex
CREATE INDEX "Audit_Log_Action_Timestamp_idx" ON "Audit_Log"("Action", "Timestamp");

-- CreateIndex
CREATE INDEX "Audit_Log_Notification_Type_Timestamp_idx" ON "Audit_Log"("Notification_Type", "Timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRead_User_ID_Log_ID_key" ON "NotificationRead"("User_ID", "Log_ID");

-- CreateIndex
CREATE UNIQUE INDEX "Computer_Mac_Address_key" ON "Computer"("Mac_Address");

-- CreateIndex
CREATE INDEX "Computer_Is_Online_idx" ON "Computer"("Is_Online");

-- CreateIndex
CREATE INDEX "Computer_Last_Seen_idx" ON "Computer"("Last_Seen");

-- CreateIndex
CREATE INDEX "Computer_Mac_Address_idx" ON "Computer"("Mac_Address");

-- CreateIndex
CREATE UNIQUE INDEX "ComputerHeartbeat_Session_ID_key" ON "ComputerHeartbeat"("Session_ID");

-- CreateIndex
CREATE INDEX "ComputerHeartbeat_Status_idx" ON "ComputerHeartbeat"("Status");

-- CreateIndex
CREATE INDEX "ComputerHeartbeat_Session_ID_idx" ON "ComputerHeartbeat"("Session_ID");

-- CreateIndex
CREATE INDEX "ComputerHeartbeat_Computer_ID_idx" ON "ComputerHeartbeat"("Computer_ID");

-- CreateIndex
CREATE INDEX "ComputerHeartbeat_User_ID_idx" ON "ComputerHeartbeat"("User_ID");

-- CreateIndex
CREATE INDEX "Weekly_Report_User_ID_idx" ON "Weekly_Report"("User_ID");

-- CreateIndex
CREATE INDEX "Weekly_Report_Status_idx" ON "Weekly_Report"("Status");

-- CreateIndex
CREATE UNIQUE INDEX "Weekly_Report_User_ID_Week_Start_key" ON "Weekly_Report"("User_ID", "Week_Start");

-- CreateIndex
CREATE INDEX "_ComputerItems_B_index" ON "_ComputerItems"("B");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_ReplacedById_fkey" FOREIGN KEY ("ReplacedById") REFERENCES "Item"("Item_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_Room_ID_fkey" FOREIGN KEY ("Room_ID") REFERENCES "Room"("Room_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_Item_ID_fkey" FOREIGN KEY ("Item_ID") REFERENCES "Item"("Item_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_Reported_By_ID_fkey" FOREIGN KEY ("Reported_By_ID") REFERENCES "User"("User_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_Room_ID_fkey" FOREIGN KEY ("Room_ID") REFERENCES "Room"("Room_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_Technician_ID_fkey" FOREIGN KEY ("Technician_ID") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_Approver_ID_fkey" FOREIGN KEY ("Approver_ID") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_Creator_ID_fkey" FOREIGN KEY ("Creator_ID") REFERENCES "User"("User_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormHistory" ADD CONSTRAINT "FormHistory_Form_ID_fkey" FOREIGN KEY ("Form_ID") REFERENCES "Form"("Form_ID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_Opened_By_fkey" FOREIGN KEY ("Opened_By") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_Created_By_fkey" FOREIGN KEY ("Created_By") REFERENCES "User"("User_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_Room_ID_fkey" FOREIGN KEY ("Room_ID") REFERENCES "Room"("Room_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booked_Room" ADD CONSTRAINT "Booked_Room_Approved_By_fkey" FOREIGN KEY ("Approved_By") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booked_Room" ADD CONSTRAINT "Booked_Room_Room_ID_fkey" FOREIGN KEY ("Room_ID") REFERENCES "Room"("Room_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booked_Room" ADD CONSTRAINT "Booked_Room_Schedule_ID_fkey" FOREIGN KEY ("Schedule_ID") REFERENCES "Schedule"("Schedule_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booked_Room" ADD CONSTRAINT "Booked_Room_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES "User"("User_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit_Log" ADD CONSTRAINT "Audit_Log_Booked_Room_ID_fkey" FOREIGN KEY ("Booked_Room_ID") REFERENCES "Booked_Room"("Booked_Room_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit_Log" ADD CONSTRAINT "Audit_Log_Ticket_ID_fkey" FOREIGN KEY ("Ticket_ID") REFERENCES "Ticket"("Ticket_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit_Log" ADD CONSTRAINT "Audit_Log_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_Log_ID_fkey" FOREIGN KEY ("Log_ID") REFERENCES "Audit_Log"("Log_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES "User"("User_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrow_Item" ADD CONSTRAINT "Borrow_Item_Borrowee_ID_fkey" FOREIGN KEY ("Borrowee_ID") REFERENCES "User"("User_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrow_Item" ADD CONSTRAINT "Borrow_Item_Borrower_ID_fkey" FOREIGN KEY ("Borrower_ID") REFERENCES "User"("User_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrow_Item" ADD CONSTRAINT "Borrow_Item_Item_ID_fkey" FOREIGN KEY ("Item_ID") REFERENCES "Item"("Item_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrow_Item" ADD CONSTRAINT "Borrow_Item_Room_ID_fkey" FOREIGN KEY ("Room_ID") REFERENCES "Room"("Room_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrowing_Comp" ADD CONSTRAINT "Borrowing_Comp_Computer_ID_fkey" FOREIGN KEY ("Computer_ID") REFERENCES "Computer"("Computer_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrowing_Comp" ADD CONSTRAINT "Borrowing_Comp_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES "User"("User_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Computer" ADD CONSTRAINT "Computer_Room_ID_fkey" FOREIGN KEY ("Room_ID") REFERENCES "Room"("Room_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Computer" ADD CONSTRAINT "Computer_Current_User_ID_fkey" FOREIGN KEY ("Current_User_ID") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerHeartbeat" ADD CONSTRAINT "ComputerHeartbeat_Computer_ID_fkey" FOREIGN KEY ("Computer_ID") REFERENCES "Computer"("Computer_ID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerHeartbeat" ADD CONSTRAINT "ComputerHeartbeat_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Weekly_Report" ADD CONSTRAINT "Weekly_Report_User_ID_fkey" FOREIGN KEY ("User_ID") REFERENCES "User"("User_ID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Weekly_Report" ADD CONSTRAINT "Weekly_Report_Reviewed_By_fkey" FOREIGN KEY ("Reviewed_By") REFERENCES "User"("User_ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ComputerItems" ADD CONSTRAINT "_ComputerItems_A_fkey" FOREIGN KEY ("A") REFERENCES "Computer"("Computer_ID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ComputerItems" ADD CONSTRAINT "_ComputerItems_B_fkey" FOREIGN KEY ("B") REFERENCES "Item"("Item_ID") ON DELETE CASCADE ON UPDATE CASCADE;

