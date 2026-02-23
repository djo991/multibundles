/**
 * Multi-Market Pricing Engine
 *
 * Manages per-market price overrides for bundles using Shopify's PriceList API.
 * Only available on the Global plan.
 *
 * Flow:
 * 1. Merchant sets a market override price (with optional rounding rule) in the UI
 * 2. We find or create a PriceList associated with that market
 * 3. We apply the fixed price to the bundle's parent product variant in that PriceList
 * 4. Shopify serves the market-specific price at checkout
 */

import type { AdminApiContextWithoutRest } from "@shopify/shopify-app-react-router/server";
import {
  getMarketOverrides,
  upsertMarketOverride,
  deleteMarketOverride,
} from "~/models/market-override.server";
import {
  GET_MARKETS,
  GET_PRICE_LISTS,
  PRICE_LIST_FIXED_PRICES_UPDATE,
} from "~/graphql/market-queries";
import { applyRoundingRule } from "~/services/pricing.server";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Market {
  id: string;
  name: string;
  enabled: boolean;
  primary: boolean;
  currencyCode: string;
  currencyName: string;
}

export interface PriceList {
  id: string;
  name: string;
  currency: string;
  marketId: string | null;
}

// ─── Market Fetching ──────────────────────────────────────────────────────────

/**
 * Fetch all Shopify markets for the current shop.
 */
export async function fetchMarkets(
  admin: AdminApiContextWithoutRest["admin"],
): Promise<Market[]> {
  const response = await admin.graphql(GET_MARKETS);
  const json = await response.json();

  return (json.data?.markets?.nodes ?? []).map((m: any) => ({
    id: m.id,
    name: m.name,
    enabled: m.enabled,
    primary: m.primary,
    currencyCode: m.currencySettings?.baseCurrency?.currencyCode ?? "USD",
    currencyName: m.currencySettings?.baseCurrency?.currencyName ?? "",
  }));
}

/**
 * Fetch all existing PriceLists and their associated markets.
 */
export async function fetchPriceLists(
  admin: AdminApiContextWithoutRest["admin"],
): Promise<PriceList[]> {
  const response = await admin.graphql(GET_PRICE_LISTS);
  const json = await response.json();

  return (json.data?.priceLists?.nodes ?? []).map((pl: any) => {
    const marketId =
      pl.catalog?.markets?.nodes?.[0]?.id ?? null;
    return {
      id: pl.id,
      name: pl.name,
      currency: pl.currency,
      marketId,
    };
  });
}

// ─── Price Override Application ────────────────────────────────────────────────

/**
 * Apply a market price override to a bundle's parent product variant.
 *
 * 1. Find the PriceList associated with the market (or create one)
 * 2. Apply rounding rule to the price
 * 3. Update the PriceList with the fixed price for the parent variant
 * 4. Save the override to our DB
 */
export async function applyMarketPriceOverride(
  admin: AdminApiContextWithoutRest["admin"],
  bundleId: string,
  parentVariantGid: string,
  marketId: string,
  marketName: string,
  currencyCode: string,
  rawPrice: number,
  roundingRule: string | null,
): Promise<{ success: boolean; error?: string }> {
  // Apply rounding rule (e.g., 27.43 + ".99" → 27.99)
  const finalPrice = applyRoundingRule(rawPrice, roundingRule);
  const priceStr = finalPrice.toFixed(2);

  // Find the PriceList for this market
  const priceLists = await fetchPriceLists(admin);
  const marketPriceList = priceLists.find((pl) => pl.marketId === marketId);

  if (!marketPriceList) {
    // Create a PriceList for this market
    const createResult = await createPriceListForMarket(
      admin,
      marketName,
      currencyCode,
      marketId,
    );
    if (!createResult.priceListId) {
      return {
        success: false,
        error: createResult.error ?? "Failed to create price list",
      };
    }

    // Apply price to the new PriceList
    const updateResult = await updatePriceListVariantPrice(
      admin,
      createResult.priceListId,
      parentVariantGid,
      priceStr,
      currencyCode,
    );
    if (!updateResult.success) {
      return updateResult;
    }
  } else {
    // Apply price to existing PriceList
    const updateResult = await updatePriceListVariantPrice(
      admin,
      marketPriceList.id,
      parentVariantGid,
      priceStr,
      currencyCode,
    );
    if (!updateResult.success) {
      return updateResult;
    }
  }

  // Save override to DB
  await upsertMarketOverride(bundleId, {
    marketGid: marketId,
    marketName,
    currencyCode,
    fixedPrice: finalPrice,
    roundingRule,
  });

  return { success: true };
}

/**
 * Remove a market price override — deletes from PriceList and DB.
 */
export async function removeMarketPriceOverride(
  admin: AdminApiContextWithoutRest["admin"],
  bundleId: string,
  marketId: string,
  parentVariantGid: string,
): Promise<{ success: boolean; error?: string }> {
  // Find the PriceList for this market
  const priceLists = await fetchPriceLists(admin);
  const marketPriceList = priceLists.find((pl) => pl.marketId === marketId);

  if (marketPriceList) {
    // Remove price from PriceList
    try {
      const response = await admin.graphql(PRICE_LIST_FIXED_PRICES_UPDATE, {
        variables: {
          priceListId: marketPriceList.id,
          pricesToAdd: [],
          variantIdsToDelete: [parentVariantGid],
        },
      });
      const json = await response.json();
      const errors = json.data?.priceListFixedPricesUpdate?.userErrors ?? [];
      if (errors.length > 0) {
        console.error("PriceList delete errors:", errors);
      }
    } catch (e) {
      console.error("Failed to remove price from PriceList:", e);
    }
  }

  // Remove from DB
  await deleteMarketOverride(bundleId, marketId);
  return { success: true };
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

async function createPriceListForMarket(
  admin: AdminApiContextWithoutRest["admin"],
  marketName: string,
  currencyCode: string,
  marketId: string,
): Promise<{ priceListId?: string; error?: string }> {
  try {
    const response = await admin.graphql(
      `#graphql
      mutation CreatePriceList($input: PriceListCreateInput!) {
        priceListCreate(input: $input) {
          priceList {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: {
            name: `MultiBundles - ${marketName}`,
            currency: currencyCode,
            parent: {
              adjustment: {
                type: "PERCENTAGE_DECREASE",
                value: 0,
              },
            },
            catalogContextualPricing: {
              catalogId: null, // Will be linked via market below
            },
          },
        },
      },
    );

    const json = await response.json();
    const errors = json.data?.priceListCreate?.userErrors ?? [];
    if (errors.length > 0) {
      return { error: errors[0].message };
    }

    return { priceListId: json.data?.priceListCreate?.priceList?.id };
  } catch (e) {
    console.error("Failed to create price list:", e);
    return { error: String(e) };
  }
}

async function updatePriceListVariantPrice(
  admin: AdminApiContextWithoutRest["admin"],
  priceListId: string,
  variantGid: string,
  price: string,
  currencyCode: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await admin.graphql(PRICE_LIST_FIXED_PRICES_UPDATE, {
      variables: {
        priceListId,
        pricesToAdd: [
          {
            variantId: variantGid,
            price: {
              amount: price,
              currencyCode,
            },
          },
        ],
        variantIdsToDelete: [],
      },
    });

    const json = await response.json();
    const errors =
      json.data?.priceListFixedPricesUpdate?.userErrors ?? [];

    if (errors.length > 0) {
      return { success: false, error: errors[0].message };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
