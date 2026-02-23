/**
 * Prisma Seed Script
 *
 * Populates the development database with representative test data
 * for each bundle type so you can iterate on the admin UI quickly.
 *
 * Usage:
 *   npx prisma db seed
 *
 * Or:
 *   node --loader ts-node/esm prisma/seed.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_SHOP = "my-dev-store.myshopify.com";

// Fake Shopify GIDs — these match the test fixtures in extensions/cart-transform/src/
const VARIANT = (n: number) => `gid://shopify/ProductVariant/${n}`;
const PRODUCT = (n: number) => `gid://shopify/Product/${n}`;

async function main() {
  console.log("🌱 Seeding database…");

  // Upsert the test shop
  const shop = await prisma.shop.upsert({
    where: { shopDomain: TEST_SHOP },
    update: {},
    create: { shopDomain: TEST_SHOP, activePlan: "launch" },
  });

  console.log(`  Shop: ${shop.shopDomain} (plan: ${shop.activePlan})`);

  // ─── 1. Fixed Bundle ──────────────────────────────────────────────
  const fixedBundle = await prisma.bundle.upsert({
    where: { shopId_productGid: { shopId: shop.id, productGid: PRODUCT(100) } },
    update: {},
    create: {
      shopId: shop.id,
      productGid: PRODUCT(100),
      productTitle: "Skincare Starter Kit",
      productHandle: "skincare-starter-kit",
      bundleType: "fixed",
      title: "Skincare Starter Kit",
      description: "Everything you need to start your skincare routine.",
      discountType: "percentage",
      discountValue: 15,
      bundlePrice: 38.25,
      compareAtPrice: 45.0,
      status: "active",
    },
  });

  // Components
  await prisma.bundleComponent.upsert({
    where: {
      bundleId_variantGid: {
        bundleId: fixedBundle.id,
        variantGid: VARIANT(101),
      },
    },
    update: {},
    create: {
      bundleId: fixedBundle.id,
      variantGid: VARIANT(101),
      productGid: PRODUCT(101),
      variantTitle: "30ml",
      productTitle: "Daily Cleanser",
      sku: "CLEAN-30ML",
      originalPrice: 18.0,
      pricePerUnit: 15.3,
      quantity: 1,
      sortOrder: 0,
      isFixed: true,
    },
  });

  await prisma.bundleComponent.upsert({
    where: {
      bundleId_variantGid: {
        bundleId: fixedBundle.id,
        variantGid: VARIANT(102),
      },
    },
    update: {},
    create: {
      bundleId: fixedBundle.id,
      variantGid: VARIANT(102),
      productGid: PRODUCT(102),
      variantTitle: "50ml",
      productTitle: "Hydrating Toner",
      sku: "TONER-50ML",
      originalPrice: 15.0,
      pricePerUnit: 12.75,
      quantity: 1,
      sortOrder: 1,
      isFixed: true,
    },
  });

  await prisma.bundleComponent.upsert({
    where: {
      bundleId_variantGid: {
        bundleId: fixedBundle.id,
        variantGid: VARIANT(103),
      },
    },
    update: {},
    create: {
      bundleId: fixedBundle.id,
      variantGid: VARIANT(103),
      productGid: PRODUCT(103),
      variantTitle: "75ml",
      productTitle: "Moisturizer SPF 30",
      sku: "MOIST-75ML",
      originalPrice: 12.0,
      pricePerUnit: 10.2,
      quantity: 1,
      sortOrder: 2,
      isFixed: true,
    },
  });

  console.log(`  ✓ Fixed bundle: "${fixedBundle.title}" (3 components)`);

  // ─── 2. Mix & Match Bundle ────────────────────────────────────────
  const mmBundle = await prisma.bundle.upsert({
    where: { shopId_productGid: { shopId: shop.id, productGid: PRODUCT(200) } },
    update: {},
    create: {
      shopId: shop.id,
      productGid: PRODUCT(200),
      productTitle: "Pick Any 3 Snacks",
      productHandle: "pick-any-3-snacks",
      bundleType: "mix_and_match",
      title: "Pick Any 3 Snacks",
      description: "Choose any 3 snacks from our curated selection.",
      discountType: "manual_price",
      discountValue: 0,
      bundlePrice: 12.0,
      compareAtPrice: 15.0,
      status: "active",
    },
  });

  await prisma.bundleSelectionRules.upsert({
    where: { bundleId: mmBundle.id },
    update: {},
    create: {
      bundleId: mmBundle.id,
      minSelections: 3,
      maxSelections: 3,
    },
  });

  const poolVariants = [
    { vid: VARIANT(201), pid: PRODUCT(201), title: "Dark Chocolate Bar", sku: "SNACK-CHOC", price: 5.0 },
    { vid: VARIANT(202), pid: PRODUCT(202), title: "Salted Caramel Almonds", sku: "SNACK-ALM", price: 5.0 },
    { vid: VARIANT(203), pid: PRODUCT(203), title: "Spicy Trail Mix", sku: "SNACK-TRAIL", price: 5.0 },
    { vid: VARIANT(204), pid: PRODUCT(204), title: "Coconut Granola Bites", sku: "SNACK-GRAN", price: 5.0 },
    { vid: VARIANT(205), pid: PRODUCT(205), title: "Dried Mango Strips", sku: "SNACK-MANGO", price: 5.0 },
  ];

  for (const v of poolVariants) {
    await prisma.selectablePool.upsert({
      where: {
        bundleId_variantGid: { bundleId: mmBundle.id, variantGid: v.vid },
      },
      update: {},
      create: {
        bundleId: mmBundle.id,
        variantGid: v.vid,
        productGid: v.pid,
        variantTitle: "Default",
        productTitle: v.title,
        originalPrice: v.price,
      },
    });
  }

  console.log(`  ✓ Mix & Match bundle: "${mmBundle.title}" (${poolVariants.length} pool variants)`);

  // ─── 3. Volume Bundle ─────────────────────────────────────────────
  const volBundle = await prisma.bundle.upsert({
    where: { shopId_productGid: { shopId: shop.id, productGid: PRODUCT(300) } },
    update: {},
    create: {
      shopId: shop.id,
      productGid: PRODUCT(300),
      productTitle: "Premium Coffee Beans",
      productHandle: "premium-coffee-beans",
      bundleType: "volume",
      title: "Premium Coffee Beans — Volume Discount",
      discountType: "percentage",
      discountValue: 0,
      status: "active",
    },
  });

  const tiers = [
    { minQty: 2, type: "percentage", value: 10 },
    { minQty: 3, type: "percentage", value: 15 },
    { minQty: 5, type: "percentage", value: 25 },
  ];

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    await prisma.volumeTier.upsert({
      where: {
        bundleId_minQuantity: { bundleId: volBundle.id, minQuantity: t.minQty },
      },
      update: {},
      create: {
        bundleId: volBundle.id,
        minQuantity: t.minQty,
        discountType: t.type,
        discountValue: t.value,
        sortOrder: i,
      },
    });
  }

  console.log(`  ✓ Volume bundle: "${volBundle.title}" (${tiers.length} tiers)`);

  // ─── 4. Custom Bundle (Global plan feature) ───────────────────────
  await prisma.shop.update({
    where: { id: shop.id },
    data: { activePlan: "global" },
  });

  const customBundle = await prisma.bundle.upsert({
    where: { shopId_productGid: { shopId: shop.id, productGid: PRODUCT(400) } },
    update: {},
    create: {
      shopId: shop.id,
      productGid: PRODUCT(400),
      productTitle: "Phone Starter Pack",
      productHandle: "phone-starter-pack",
      bundleType: "custom",
      title: "Phone Starter Pack",
      description: "Phone case always included — pick 2 accessories.",
      discountType: "manual_price",
      discountValue: 0,
      bundlePrice: 30.0,
      compareAtPrice: 40.0,
      status: "draft",
    },
  });

  // Fixed component (always included)
  await prisma.bundleComponent.upsert({
    where: {
      bundleId_variantGid: {
        bundleId: customBundle.id,
        variantGid: VARIANT(401),
      },
    },
    update: {},
    create: {
      bundleId: customBundle.id,
      variantGid: VARIANT(401),
      productGid: PRODUCT(401),
      variantTitle: "Clear",
      productTitle: "Phone Case",
      sku: "CASE-CLEAR",
      originalPrice: 20.0,
      pricePerUnit: 16.0,
      quantity: 1,
      sortOrder: 0,
      isFixed: true,
    },
  });

  // Selectable pool
  const customPool = [
    { vid: VARIANT(402), pid: PRODUCT(402), title: "USB-C Charging Cable", price: 8.0 },
    { vid: VARIANT(403), pid: PRODUCT(403), title: "Screen Protector", price: 8.0 },
    { vid: VARIANT(404), pid: PRODUCT(404), title: "Wireless Earbuds", price: 12.0 },
  ];

  for (const v of customPool) {
    await prisma.selectablePool.upsert({
      where: {
        bundleId_variantGid: { bundleId: customBundle.id, variantGid: v.vid },
      },
      update: {},
      create: {
        bundleId: customBundle.id,
        variantGid: v.vid,
        productGid: v.pid,
        variantTitle: "Default",
        productTitle: v.title,
        originalPrice: v.price,
      },
    });
  }

  await prisma.bundleSelectionRules.upsert({
    where: { bundleId: customBundle.id },
    update: {},
    create: {
      bundleId: customBundle.id,
      minSelections: 2,
      maxSelections: 2,
    },
  });

  console.log(`  ✓ Custom bundle: "${customBundle.title}" (1 fixed + ${customPool.length} pool)`);

  console.log("\n✅ Seed complete!");
  console.log(
    `   Open the admin UI at http://localhost:3000/app/bundles to see the seed data.\n`,
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
