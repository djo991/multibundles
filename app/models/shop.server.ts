import prisma from "~/db.server";

export async function getShop(shopDomain: string) {
  return prisma.shop.findUnique({
    where: { shopDomain },
  });
}

export async function getOrCreateShop(shopDomain: string) {
  return prisma.shop.upsert({
    where: { shopDomain },
    update: { uninstalledAt: null },
    create: { shopDomain },
  });
}

export async function updateShopPlan(
  shopDomain: string,
  plan: string,
  subscriptionGid?: string,
) {
  return prisma.shop.update({
    where: { shopDomain },
    data: {
      activePlan: plan,
      subscriptionGid: subscriptionGid ?? null,
    },
  });
}

export async function markShopUninstalled(shopDomain: string) {
  return prisma.shop.update({
    where: { shopDomain },
    data: { uninstalledAt: new Date() },
  });
}

export async function deleteShopData(shopDomain: string) {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });
  if (shop) {
    await prisma.shop.delete({ where: { id: shop.id } });
  }
}
