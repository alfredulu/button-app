import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Enable SQLite optimizations (use $queryRawUnsafe for pragmas that return rows)
prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch(() => {});
prisma.$executeRawUnsafe("PRAGMA synchronous=NORMAL;").catch(() => {});
prisma.$executeRawUnsafe("PRAGMA foreign_keys=ON;").catch(() => {});
