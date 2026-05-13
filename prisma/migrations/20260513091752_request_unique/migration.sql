-- CreateIndex
CREATE UNIQUE INDEX "MusicRequest_userId_mbid_type_key" ON "MusicRequest"("userId", "mbid", "type");
