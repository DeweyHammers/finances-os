import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: "global" },
    });

    if (!settings) {
      await prisma.appSettings.upsert({
        where: { id: "global" },
        update: {
          upworkActive: true,
          eddActive: true,
          baseEddWeeklyAmount: 450,
          paymentCycle: "BI_WEEKLY",
        },
        create: {
          id: "global",
          upworkActive: true,
          eddActive: true,
          baseEddWeeklyAmount: 450,
          paymentCycle: "BI_WEEKLY",
        },
      });
      console.log("Ensured AppSettings exists with id 'global' and EDD/UpWork active.");
    } else {
      await prisma.appSettings.update({
        where: { id: "global" },
        data: { 
          upworkActive: true,
          eddActive: true,
          baseEddWeeklyAmount: 450
        },
      });
      console.log("Updated AppSettings: EDD and UpWork are now Active.");
    }
  } catch (error) {
    console.error("Error updating settings:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
