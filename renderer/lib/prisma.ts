import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({
  url: "file:./prisma/dev.db",
});

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter });

export function getModel(resource: string) {
  const modelName = resource.charAt(0).toLowerCase() + resource.slice(1);
  let model = (prisma as any)[modelName];

  // Fallback for different casing if first attempt fails
  if (!model) {
    const keys = Object.keys(prisma);
    const match = keys.find(
      (key) => key.toLowerCase() === resource.toLowerCase(),
    );
    if (match) {
      model = (prisma as any)[match];
    }
  }
  return model;
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
