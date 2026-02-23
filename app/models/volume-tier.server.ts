import prisma from "~/db.server";

export interface VolumeTierInput {
  minQuantity: number;
  discountType: string;
  discountValue: number;
  sortOrder: number;
}

export async function setVolumeTiers(
  bundleId: string,
  tiers: VolumeTierInput[],
) {
  await prisma.volumeTier.deleteMany({ where: { bundleId } });

  if (tiers.length === 0) return [];

  return prisma.volumeTier.createMany({
    data: tiers.map((t) => ({
      bundleId,
      minQuantity: t.minQuantity,
      discountType: t.discountType,
      discountValue: t.discountValue,
      sortOrder: t.sortOrder,
    })),
  });
}

export async function getVolumeTiers(bundleId: string) {
  return prisma.volumeTier.findMany({
    where: { bundleId },
    orderBy: { sortOrder: "asc" },
  });
}
