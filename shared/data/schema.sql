-- GENERATED FILE — do not edit. Source: prisma/schema.prisma.
-- Regenerate with: npx tsx scripts/generate-schema-sql.ts
--
-- Creates every table of an EMPTY Finances OS database and stamps it with
-- schema version 1 (shared/data/schema.ts → SCHEMA_VERSION).

-- CreateTable
CREATE TABLE "Income" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "amount" REAL NOT NULL DEFAULT 0.00,
    "paymentCycle" TEXT NOT NULL DEFAULT 'WEEKLY',
    "payDay" INTEGER NOT NULL DEFAULT 3,
    "payWeekOffset" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "paymentCycle" TEXT NOT NULL DEFAULT 'BI_WEEKLY',
    "payDay" INTEGER NOT NULL DEFAULT 2,
    "eddActive" BOOLEAN NOT NULL DEFAULT true,
    "eddRemainingBalance" REAL NOT NULL DEFAULT 7200.00,
    "baseEddWeeklyAmount" REAL NOT NULL DEFAULT 450.00,
    "w2Active" BOOLEAN NOT NULL DEFAULT false,
    "w2Amount" REAL NOT NULL DEFAULT 0.00,
    "upworkActive" BOOLEAN NOT NULL DEFAULT true,
    "upworkTaxProvisionPercent" REAL NOT NULL DEFAULT 0.25,
    "upworkExpensesHoldActive" BOOLEAN NOT NULL DEFAULT false,
    "upworkExpensesHoldAmount" REAL NOT NULL DEFAULT 0.00,
    "upworkMinWithdrawalAmount" REAL NOT NULL DEFAULT 0.00,
    "wifeMonthlyAmount" REAL NOT NULL DEFAULT 0.00,
    "wifeWeeklyTargetCents" INTEGER NOT NULL DEFAULT 30000,
    "optimizedInputsSig" TEXT
);

-- CreateTable
CREATE TABLE "Earning" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "isWithdrawn" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "DeductibleExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "EddPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "type" TEXT NOT NULL DEFAULT 'HOURLY',
    "grossRate" REAL NOT NULL DEFAULT 0.00,
    "netRate" REAL NOT NULL DEFAULT 0.00,
    "feePercent" REAL NOT NULL DEFAULT 10.0,
    "weeklyHours" INTEGER NOT NULL DEFAULT 0,
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" DATETIME,
    "completedDate" DATETIME,
    "clientId" TEXT NOT NULL,
    CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grossPay" REAL NOT NULL,
    "netPay" REAL NOT NULL,
    "hours" REAL NOT NULL DEFAULT 0.0,
    "contractId" TEXT NOT NULL,
    CONSTRAINT "ContractEntry_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "dueDate" INTEGER NOT NULL DEFAULT 1,
    "withdrawalCycle" TEXT NOT NULL DEFAULT 'Q1',
    "isAutoPay" BOOLEAN NOT NULL DEFAULT true,
    "neverSplit" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "BillSplit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "occurrenceCoord" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BillSplit_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Personal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "dueDate" INTEGER NOT NULL DEFAULT 1,
    "weekOfMonth" INTEGER,
    "withdrawalCycle" TEXT NOT NULL DEFAULT 'Q1',
    "repeatWeekly" BOOLEAN NOT NULL DEFAULT false,
    "splitAcrossWeeks" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "YearlyCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "JobReported" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employerName" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "AccountTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payeeId" TEXT,
    "categoryItemId" TEXT,
    "categoryName" TEXT,
    "memo" TEXT,
    "inflowCents" INTEGER NOT NULL DEFAULT 0,
    "outflowCents" INTEGER NOT NULL DEFAULT 0,
    "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "cleared" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "AccountTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountTransaction_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "Payee" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AccountTransaction_categoryItemId_fkey" FOREIGN KEY ("categoryItemId") REFERENCES "BudgetCategoryItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "BudgetCategoryGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "BudgetCategorySubsection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BudgetCategorySubsection_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BudgetCategoryGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BudgetCategoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "subsectionId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourceType" TEXT NOT NULL,
    "sourceBillId" TEXT,
    "sourcePersonalName" TEXT,
    "customAmountCents" INTEGER,
    "customCycle" TEXT,
    CONSTRAINT "BudgetCategoryItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BudgetCategoryGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BudgetCategoryItem_subsectionId_fkey" FOREIGN KEY ("subsectionId") REFERENCES "BudgetCategorySubsection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BudgetMonth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "month" DATETIME NOT NULL,
    "categoryItemId" TEXT NOT NULL,
    "assignedCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BudgetMonth_categoryItemId_fkey" FOREIGN KEY ("categoryItemId") REFERENCES "BudgetCategoryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SchemaVersion" (
    "version" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "BillSplit_billId_monthKey_weekIndex_occurrenceCoord_key" ON "BillSplit"("billId", "monthKey", "weekIndex", "occurrenceCoord");

-- CreateIndex
CREATE UNIQUE INDEX "Payee_name_key" ON "Payee"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetMonth_month_categoryItemId_key" ON "BudgetMonth"("month", "categoryItemId");

-- SchemaVersion stamp (appliedAt = Unix milliseconds, the DateTime storage
-- format shared with Prisma).
INSERT INTO "SchemaVersion" ("version", "appliedAt") VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
