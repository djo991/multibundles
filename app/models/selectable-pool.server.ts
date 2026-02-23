import prisma from "~/db.server";

export interface PoolVariantInput {
  variantGid: string;
  productGid: string;
  variantTitle: string;
  productTitle: string;
  imageUrl?: string;
  originalPrice?: number;
}

export async function setSelectablePool(
  bundleId: string,
  variants: PoolVariantInput[],
) {
  await prisma.selectablePool.deleteMany({ where: { bundleId } });

  if (variants.length === 0) return [];

  return prisma.selectablePool.createMany({
    data: variants.map((v) => ({
      bundleId,
      variantGid: v.variantGid,
      productGid: v.productGid,
      variantTitle: v.variantTitle,
      productTitle: v.productTitle,
      imageUrl: v.imageUrl,
      originalPrice: v.originalPrice,
    })),
  });
}

export async function getSelectablePool(bundleId: string) {
  return prisma.selectablePool.findMany({
    where: { bundleId },
  });
}

export async function setSelectionRules(
  bundleId: string,
  minSelections: number,
  maxSelections: number,
) {
  return prisma.bundleSelectionRules.upsert({
    where: { bundleId },
    update: { minSelections, maxSelections },
    create: { bundleId, minSelections, maxSelections },
  });
}
