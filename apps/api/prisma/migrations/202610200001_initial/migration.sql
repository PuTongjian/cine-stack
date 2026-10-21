CREATE TABLE "Movie" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "year" TEXT NOT NULL,
  "poster" TEXT,
  "metadata" TEXT NOT NULL,
  "watchedAt" DATETIME,
  "rating" REAL,
  "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "Task" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "movieId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "stage" TEXT NOT NULL DEFAULT 'queued',
  "payload" TEXT NOT NULL,
  "result" TEXT NOT NULL DEFAULT '{}',
  "error" TEXT,
  "remoteTaskId" TEXT,
  "targetFolderId" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Task_idempotencyKey_key" ON "Task"("idempotencyKey");
CREATE TABLE "Resource" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "movieId" INTEGER NOT NULL,
  "searchId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "postUrl" TEXT NOT NULL,
  "shareId" TEXT NOT NULL,
  "passcode" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Resource_searchId_shareId_key" ON "Resource"("searchId", "shareId");
