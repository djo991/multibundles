import prisma from "~/db.server";

export interface ComponentInput {
  variantGid: string;
  productGid: string;
  variantTitle: string;
  productTitle: string;
  sku?: string;
  imageUrl?: string;
  quantity: number;
  sortOrder: number;
  isFixed?: boolean;
  originalPrice?: number;
}

export async function setComponents(
  bundleId: string,
  components: ComponentInput[],
) {
  // Delete existing components and replace
  await prisma.bundleComponent.deleteMany({ where: { bundleId } });

  if (components.length === 0) return [];

  return prisma.bundleComponent.createMany({
    data: components.map((c) => ({
      bundleId,
      variantGid: c.variantGid,
      productGid: c.productGid,
      variantTitle: c.variantTitle,
      productTitle: c.productTitle,
      sku: c.sku,
      imageUrl: c.imageUrl,
      quantity: c.quantity,
      sortOrder: c.sortOrder,
      isFixed: c.isFixed ?? true,
      originalPrice: c.originalPrice,
    })),
  });
}

export async function updateComponentPrices(
  bundleId: string,
  prices: Array<{ variantGid: string; pricePerUnit: number }>,
) {
  const updates = prices.map((p) =>
    prisma.bundleComponent.updateMany({
      where: { bundleId, variantGid: p.variantGid },
      data: { pricePerUnit: p.pricePerUnit },
    }),
  );
  await prisma.$transaction(updates);
}

export async function getComponents(bundleId: string) {
  return prisma.bundleComponent.findMany({
    where: { bundleId },
    orderBy: { sortOrder: "asc" },
  });
}
