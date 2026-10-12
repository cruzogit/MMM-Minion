-- Brings back the "Resource" table: the file records of a task (attachments and completion proof), and of a lead, deal, customer, project
-- or landscape. A schema push that no longer listed the model dropped the table from the live database; the Tasks screens still use it.
-- Additive only: one new, empty table (the rows that were in it cannot be recreated by this file: restore them from a Supabase backup if
-- they are needed). The files themselves stay in Storage; only their records are missing.
-- Same shape as the Prisma model "Resource"; every link is optional and is cleared (not the file record deleted) when the thing it points to goes.
-- Row Level Security on and no direct grant to anon / authenticated, like the other tables: only the server reads and writes it.
-- To undo: DROP TABLE "Resource".

CREATE TABLE IF NOT EXISTS "Resource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "ownerId" TEXT,
    "projectId" TEXT,
    "customerId" TEXT,
    "leadId" TEXT,
    "dealId" TEXT,
    "taskId" TEXT,
    "landscapeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Resource_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Resource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Resource_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Resource_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Resource_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Resource_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Resource_landscapeId_fkey" FOREIGN KEY ("landscapeId") REFERENCES "Landscape"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Resource_taskId_idx" ON "Resource"("taskId");
CREATE INDEX IF NOT EXISTS "Resource_storagePath_idx" ON "Resource"("storagePath");

ALTER TABLE "Resource" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Resource" FROM anon, authenticated;
