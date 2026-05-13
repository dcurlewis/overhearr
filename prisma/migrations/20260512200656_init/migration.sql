-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "data" TEXT NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "lidarrUrl" TEXT,
    "lidarrApiKeyEncrypted" TEXT,
    "lidarrRootFolderPath" TEXT,
    "lidarrQualityProfileId" INTEGER,
    "lidarrMetadataProfileId" INTEGER,
    "lastfmApiKeyEncrypted" TEXT,
    "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MusicRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "mbid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "artistName" TEXT,
    "coverArtUrl" TEXT,
    "releaseDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lidarrAlbumId" INTEGER,
    "lidarrArtistId" INTEGER,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MusicRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "MusicRequest_userId_createdAt_idx" ON "MusicRequest"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MusicRequest_mbid_type_idx" ON "MusicRequest"("mbid", "type");

-- CreateIndex
CREATE INDEX "MusicRequest_status_idx" ON "MusicRequest"("status");
