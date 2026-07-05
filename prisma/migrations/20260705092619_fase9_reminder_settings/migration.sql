-- CreateTable
CREATE TABLE "reminder_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "thresholdsLongDays" INTEGER[] DEFAULT ARRAY[30, 15, 7]::INTEGER[],
    "thresholdsShortDays" INTEGER[] DEFAULT ARRAY[10, 5, 1]::INTEGER[],
    "overdueDays" INTEGER[] DEFAULT ARRAY[0, 1, 2, 7, 10]::INTEGER[],
    "cessationDay" INTEGER NOT NULL DEFAULT 11,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_templates" (
    "type" "NotificationType" NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_templates_pkey" PRIMARY KEY ("type")
);
