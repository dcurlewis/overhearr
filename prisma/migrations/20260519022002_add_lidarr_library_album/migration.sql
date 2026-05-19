-- CreateTable
CREATE TABLE "LidarrLibraryAlbum" (
    "foreignAlbumId" TEXT NOT NULL PRIMARY KEY,
    "foreignArtistId" TEXT NOT NULL,
    "lidarrAlbumId" INTEGER NOT NULL,
    "lidarrArtistId" INTEGER NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "LidarrLibraryAlbum_foreignArtistId_idx" ON "LidarrLibraryAlbum"("foreignArtistId");
