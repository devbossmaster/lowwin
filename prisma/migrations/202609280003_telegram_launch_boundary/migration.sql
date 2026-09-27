-- Existing credential/player sessions gain no Mini App authorization retroactively.
ALTER TABLE "session" ADD COLUMN "telegramLaunchId" TEXT;
