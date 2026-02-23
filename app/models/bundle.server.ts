import prisma from "~/db.server";
import type { Bundle, Prisma } from "@prisma/client";

export type BundleWithRelations = Prisma.BundleGetPayload<{
  include: {
    components: true;
    selectablePool: true;
    selectionRules: true;
    volumeTiers: true;
    marketOverrides: true;
  };
}>;

export async function getBundles(
  shopId: string,
  filters?: { status?: string; bundleType?: string },
) {
  return prisma.bundle.findMany({
    where: {
      shopId,
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.bundleType ? { bundleType: filters.bundleType } : {}),
    },
    include: {
      components: { orderBy: { sortOrder: "asc" } },
      selectablePool: true,
      volumeTiers: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getBundle(
  id: string,
  shopId: string,
): Promise<BundleWithRelations | null> {
  return prisma.bundle.findFirst({
    where: { id, shopId },
    include: {
      components: { orderBy: { sortOrder: "asc" } },
      selectablePool: true,
      selectionRules: true,
      volumeTiers: { orderBy: { sortOrder: "asc" } },
      marketOverrides: true,
    },
  });
}

export async function getBundleCount(shopId: string) {
  return prisma.bundle.count({ where: { shopId } });
}

export async function createBundle(data: {
  shopId: string;
  productGid: string;
  productTitle: string;
  productHandle?: string;
  productImageUrl?: string;
  bundleType: string;
  title: string;
  description?: string;
  discountType?: string;
  discountValue?: number;
  bundlePrice?: number;
  compareAtPrice?: number;
}) {
  return prisma.bundle.create({ data });
}

export async function updateBundle(
  id: string,
  shopId: string,
  data: Partial<
    Pick<
      Bundle,
      | "title"
      | "description"
      | "status"
      | "discountType"
      | "discountValue"
      | "bundlePrice"
      | "compareAtPrice"
      | "productTitle"
      | "productHandle"
      | "productImageUrl"
    >
  >,
) {
  return prisma.bundle.update({
    where: { id },
    data: { ...data, metafieldSynced: false },
  });
}

export async function markBundleSynced(id: string) {
  return prisma.bundle.update({
    where: { id },
    data: { metafieldSynced: true, lastSyncedAt: new Date() },
  });
}

export async function deleteBundle(id: string, shopId: string) {
  return prisma.bundle.deleteMany({
    where: { id, shopId },
  });
}

export async function getBundlesByComponentVariant(variantGid: string) {
  const components = await prisma.bundleComponent.findMany({
    where: { variantGid },
    include: {
      bundle: {
        include: {
          components: true,
        },
      },
    },
  });
  return components.map((c) => c.bundle);
}
