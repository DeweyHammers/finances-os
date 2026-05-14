import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.appSettings.upsert({
    where: { id: "global" },
    update: {},
    create: {
      id: "global",
      eddActive: true,
      eddRemainingBalance: 7200.0,
      baseEddWeeklyAmount: 450.0,
    },
  });

  const groupCount = await prisma.budgetCategoryGroup.count();
  if (groupCount === 0) {
    await prisma.budgetCategoryGroup.createMany({
      data: [
        { name: "Checking", sortOrder: 0 },
        { name: "Savings", sortOrder: 1 },
      ],
    });
  }

  console.log("Seed complete.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
