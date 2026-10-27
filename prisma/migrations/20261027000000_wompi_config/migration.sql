-- CreateTable
CREATE TABLE "payment_configs" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "wompiAppId" TEXT NOT NULL DEFAULT 'ba6ddd9d-e5d4-4c73-8571-9c3fde2f31e2',
    "wompiApiSecret" TEXT NOT NULL DEFAULT '4dbf191f-c328-4a98-af50-c85a6722a599',
    "wompiAuthUrl" TEXT NOT NULL DEFAULT 'https://id.wompi.sv/connect/token',
    "wompiApiUrl" TEXT NOT NULL DEFAULT 'https://api.wompi.sv',
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_configs_pkey" PRIMARY KEY ("id")
);
