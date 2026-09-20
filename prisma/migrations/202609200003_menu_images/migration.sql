CREATE TABLE "menu_images" (
  "id" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "menu_images_pkey" PRIMARY KEY ("id")
);
