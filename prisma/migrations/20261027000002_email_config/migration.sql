-- CreateTable
CREATE TABLE "email_configs" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "smtpHost" TEXT NOT NULL DEFAULT 'smtp.gmail.com',
    "smtpPort" INTEGER NOT NULL DEFAULT 465,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "smtpUser" TEXT NOT NULL DEFAULT 'piggybanksv@gmail.com',
    "smtpPass" TEXT NOT NULL DEFAULT '',
    "senderName" TEXT NOT NULL DEFAULT 'PiggyBank El Salvador',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_configs_pkey" PRIMARY KEY ("id")
);

-- Insert default initial config row
INSERT INTO "email_configs" ("id", "smtpHost", "smtpPort", "smtpSecure", "smtpUser", "smtpPass", "senderName", "isActive", "updatedAt")
VALUES (1, 'smtp.gmail.com', 465, true, 'piggybanksv@gmail.com', '', 'PiggyBank El Salvador', true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
