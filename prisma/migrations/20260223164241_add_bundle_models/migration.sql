-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "shopifyGid" TEXT,
    "activePlan" TEXT NOT NULL DEFAULT 'free',
    "subscriptionGid" TEXT,
    "trialEndsAt" DATETIME,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Bundle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productHandle" TEXT,
    "productImageUrl" TEXT,
    "bundleType" TEXT NOT NULL DEFAULT 'fixed',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL DEFAULT 'percentage',
    "discountValue" REAL NOT NULL DEFAULT 0,
    "bundlePrice" REAL,
    "compareAtPrice" REAL,
    "metafieldSynced" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bundle_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BundleComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "variantGid" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "variantTitle" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "sku" TEXT,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isFixed" BOOLEAN NOT NULL DEFAULT true,
    "pricePerUnit" REAL,
    "originalPrice" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BundleComponent_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SelectablePool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "variantGid" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "variantTitle" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "imageUrl" TEXT,
    "originalPrice" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SelectablePool_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BundleSelectionRules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "minSelections" INTEGER NOT NULL DEFAULT 1,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BundleSelectionRules_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VolumeTier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "discountType" TEXT NOT NULL DEFAULT 'percentage',
    "discountValue" REAL NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VolumeTier_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketPriceOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "marketGid" TEXT NOT NULL,
    "marketName" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "fixedPrice" REAL NOT NULL,
    "roundingRule" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketPriceOverride_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "Bundle_shopId_status_idx" ON "Bundle"("shopId", "status");

-- CreateIndex
CREATE INDEX "Bundle_productGid_idx" ON "Bundle"("productGid");

-- CreateIndex
CREATE UNIQUE INDEX "Bundle_shopId_productGid_key" ON "Bundle"("shopId", "productGid");

-- CreateIndex
CREATE INDEX "BundleComponent_bundleId_idx" ON "BundleComponent"("bundleId");

-- CreateIndex
CREATE INDEX "BundleComponent_variantGid_idx" ON "BundleComponent"("variantGid");

-- CreateIndex
CREATE UNIQUE INDEX "BundleComponent_bundleId_variantGid_key" ON "BundleComponent"("bundleId", "variantGid");

-- CreateIndex
CREATE INDEX "SelectablePool_bundleId_idx" ON "SelectablePool"("bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "SelectablePool_bundleId_variantGid_key" ON "SelectablePool"("bundleId", "variantGid");

-- CreateIndex
CREATE UNIQUE INDEX "BundleSelectionRules_bundleId_key" ON "BundleSelectionRules"("bundleId");

-- CreateIndex
CREATE INDEX "VolumeTier_bundleId_idx" ON "VolumeTier"("bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "VolumeTier_bundleId_minQuantity_key" ON "VolumeTier"("bundleId", "minQuantity");

-- CreateIndex
CREATE INDEX "MarketPriceOverride_bundleId_idx" ON "MarketPriceOverride"("bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketPriceOverride_bundleId_marketGid_key" ON "MarketPriceOverride"("bundleId", "marketGid");
