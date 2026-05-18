/*
  Warnings:

  - You are about to drop the column `lastfmApiKeyEncrypted` on the `Settings` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "lidarrUrl" TEXT,
    "lidarrApiKeyEncrypted" TEXT,
    "lidarrRootFolderPath" TEXT,
    "lidarrQualityProfileId" INTEGER,
    "lidarrMetadataProfileId" INTEGER,
    "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("createdAt", "id", "lidarrApiKeyEncrypted", "lidarrMetadataProfileId", "lidarrQualityProfileId", "lidarrRootFolderPath", "lidarrUrl", "setupCompleted", "updatedAt") SELECT "createdAt", "id", "lidarrApiKeyEncrypted", "lidarrMetadataProfileId", "lidarrQualityProfileId", "lidarrRootFolderPath", "lidarrUrl", "setupCompleted", "updatedAt" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
