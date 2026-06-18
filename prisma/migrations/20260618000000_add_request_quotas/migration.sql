-- AlterTable
ALTER TABLE "User" ADD COLUMN "quotaActiveLimit" INTEGER;
ALTER TABLE "User" ADD COLUMN "quotaWeeklyLimit" INTEGER;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "defaultQuotaActiveLimit" INTEGER;
ALTER TABLE "Settings" ADD COLUMN "defaultQuotaWeeklyLimit" INTEGER;
