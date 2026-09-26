import { PrismaClient } from '@prisma/client';
const globalDb = globalThis as unknown as { lowinDb?: PrismaClient };
export const db = globalDb.lowinDb ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalDb.lowinDb = db;
