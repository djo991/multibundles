import prisma from "~/db.server";

export interface MarketOverrideInput {
  marketGid: string;
  marketName: string;
  currencyCode: string;
  fixedPrice: number;
  roundingRule?: string;
}

export async function setMarketOverrides(
  bundleId: string,
  overrides: MarketOverrideInput[],
) {
  await prisma.marketPriceOverride.deleteMany({ where: { bundleId } });

  if (overrides.length === 0) return [];

  return prisma.marketPriceOverride.createMany({
    data: overrides.map((o) => ({
      bundleId,
      marketGid: o.marketGid,
      marketName: o.marketName,
      currencyCode: o.currencyCode,
      fixedPrice: o.fixedPrice,
      roundingRule: o.roundingRule,
    })),
  });
}

export async function getMarketOverrides(bundleId: string) {
  return prisma.marketPriceOverride.findMany({
    where: { bundleId },
  });
}
