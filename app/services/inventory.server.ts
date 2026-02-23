/**
 * Inventory Synchronization Service
 *
 * Handles real-time inventory calculation and synchronization for bundles.
 *
 * - Fixed bundles: parent available = MIN(floor(component_stock / qty_per_bundle))
 * - Custom bundles: same as fixed but only fixed components constrain availability
 * - Mix-and-match: parent set to "continue selling" (checked at Cart Transform)
 * - Volume: standard Shopify inventory, no special sync needed
 */

import type { AdminApiContextWithoutRest } from "@shopify/shopify-app-react-router/server";
import { getBundlesByComponentVariant } from "~/models/bundle.server";
import { getBundles } from "~/models/bundle.server";
import { getOrCreateShop } from "~/models/shop.server";
import {
  GET_INVENTORY_LEVELS,
  INVENTORY_SET_QUANTITIES,
} from "~/graphql/inventory-queries";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InventoryLevel {
  locationId: string;
  available: number;
}

interface VariantInventory {
  variantGid: string;
  inventoryItemGid: string;
  levels: InventoryLevel[];
  totalAvailable: number;
}

// ─── Core Calculation ─────────────────────────────────────────────────────────

/**
 * Calculate how many units of a fixed/custom bundle can be fulfilled
 * based on current component inventory levels.
 *
 * Formula: MIN(floor(component_available / component_quantity_per_bundle))
 */
export function calculateBundleAvailability(
  components: Array<{
    variantGid: string;
    quantity: number;
    isFixed?: boolean;
  }>,
  inventoryMap: Map<string, number>,
  bundleType: "fixed" | "custom" = "fixed",
): number {
  // For custom bundles, only fixed components constrain availability
  // (selectable components are checked at Cart Transform expansion)
  const constrainingComponents =
    bundleType === "custom"
      ? components.filter((c) => c.isFixed !== false)
      : components;

  if (constrainingComponents.length === 0) return 0;

  let minAvailable = Infinity;

  for (const component of constrainingComponents) {
    const componentStock = inventoryMap.get(component.variantGid) ?? 0;
    const maxBundles = Math.floor(componentStock / component.quantity);
    minAvailable = Math.min(minAvailable, maxBundles);

    if (minAvailable === 0) break; // Short-circuit: already out of stock
  }

  return minAvailable === Infinity ? 0 : minAvailable;
}

// ─── Shopify API Helpers ───────────────────────────────────────────────────────

/**
 * Fetch current inventory quantities for a list of variant GIDs.
 * Returns a map of variantGid → available quantity (sum across all locations).
 */
export async function fetchVariantInventory(
  admin: AdminApiContextWithoutRest["admin"],
  variantGids: string[],
): Promise<Map<string, number>> {
  const inventoryMap = new Map<string, number>();

  if (variantGids.length === 0) return inventoryMap;

  // Shopify's `nodes` query has a max of 250 IDs per call
  const chunks = chunkArray(variantGids, 50);

  for (const chunk of chunks) {
    try {
      const response = await admin.graphql(GET_INVENTORY_LEVELS, {
        variables: { ids: chunk },
      });
      const json = await response.json();

      for (const node of (json.data?.nodes ?? []) as any[]) {
        if (!node || node.__typename !== "ProductVariant") continue;

        const variantId = node.id as string;
        let totalAvailable = 0;

        for (const edge of node.inventoryItem?.inventoryLevels?.edges ?? []) {
          const level = edge.node;
          const availableEntry = (level.quantities ?? []).find(
            (q: any) => q.name === "available",
          );
          if (availableEntry) {
            totalAvailable += availableEntry.quantity;
          }
        }

        inventoryMap.set(variantId, totalAvailable);
      }
    } catch (e) {
      console.error("Failed to fetch inventory levels:", e);
    }
  }

  return inventoryMap;
}

/**
 * Find the inventory item GID and a location ID for a bundle's parent product
 * so we can set its available quantity.
 */
export async function getParentVariantInventoryItem(
  admin: AdminApiContextWithoutRest["admin"],
  parentVariantGid: string,
): Promise<{ inventoryItemGid: string; locationId: string } | null> {
  try {
    const response = await admin.graphql(
      `#graphql
      query GetParentVariantInventory($id: ID!) {
        node(id: $id) {
          ... on ProductVariant {
            id
            inventoryItem {
              id
              inventoryLevels(first: 1) {
                edges {
                  node {
                    id
                    location {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { id: parentVariantGid } },
    );

    const json = await response.json();
    const variant = json.data?.node;
    if (!variant) return null;

    const levelEdge = variant.inventoryItem?.inventoryLevels?.edges?.[0];
    if (!levelEdge) return null;

    return {
      inventoryItemGid: variant.inventoryItem.id,
      locationId: levelEdge.node.location.id,
    };
  } catch (e) {
    console.error("Failed to get parent variant inventory item:", e);
    return null;
  }
}

/**
 * Set the available quantity on a parent bundle product variant.
 */
export async function setParentBundleInventory(
  admin: AdminApiContextWithoutRest["admin"],
  inventoryItemGid: string,
  locationId: string,
  availableQuantity: number,
): Promise<boolean> {
  try {
    const response = await admin.graphql(INVENTORY_SET_QUANTITIES, {
      variables: {
        input: {
          reason: "correction",
          name: "available",
          quantities: [
            {
              inventoryItemId: inventoryItemGid,
              locationId,
              quantity: Math.max(0, availableQuantity),
            },
          ],
        },
      },
    });

    const json = await response.json();
    const errors = json.data?.inventorySetQuantities?.userErrors ?? [];
    if (errors.length > 0) {
      console.error("Inventory set errors:", errors);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Failed to set parent bundle inventory:", e);
    return false;
  }
}

// ─── High-level Sync Functions ────────────────────────────────────────────────

/**
 * Recalculate and update inventory for all fixed/custom bundles that contain
 * the given variant. Called from the `inventory_levels/update` webhook.
 */
export async function syncInventoryForVariant(
  admin: AdminApiContextWithoutRest["admin"],
  variantGid: string,
): Promise<void> {
  // Find all bundles that contain this variant as a component
  const affectedBundles = await getBundlesByComponentVariant(variantGid);

  for (const bundle of affectedBundles) {
    if (bundle.bundleType !== "fixed" && bundle.bundleType !== "custom") {
      continue;
    }

    await syncBundleInventory(admin, bundle);
  }
}

/**
 * Recalculate and update inventory for a specific bundle.
 * Fetches current component inventory, calculates availability, and
 * updates the parent product's inventory.
 */
export async function syncBundleInventory(
  admin: AdminApiContextWithoutRest["admin"],
  bundle: {
    id: string;
    productGid: string;
    bundleType: string;
    components: Array<{
      variantGid: string;
      quantity: number;
      isFixed?: boolean;
    }>;
  },
): Promise<void> {
  if (bundle.bundleType !== "fixed" && bundle.bundleType !== "custom") {
    return;
  }

  if (bundle.components.length === 0) return;

  // Fetch current inventory for all components
  const componentGids = bundle.components.map((c) => c.variantGid);
  const inventoryMap = await fetchVariantInventory(admin, componentGids);

  // Calculate how many bundles can be fulfilled
  const availableBundles = calculateBundleAvailability(
    bundle.components,
    inventoryMap,
    bundle.bundleType as "fixed" | "custom",
  );

  // Get the parent product's first variant and its inventory item
  // (we need the inventory item GID to update availability)
  try {
    const parentResponse = await admin.graphql(
      `#graphql
      query GetBundleParentVariants($id: ID!) {
        product(id: $id) {
          variants(first: 1) {
            edges {
              node {
                id
                inventoryItem {
                  id
                  inventoryLevels(first: 1) {
                    edges {
                      node {
                        location {
                          id
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { id: bundle.productGid } },
    );

    const parentJson = await parentResponse.json();
    const variantEdge =
      parentJson.data?.product?.variants?.edges?.[0];
    if (!variantEdge) return;

    const parentVariant = variantEdge.node;
    const levelEdge =
      parentVariant.inventoryItem?.inventoryLevels?.edges?.[0];
    if (!levelEdge) return;

    await setParentBundleInventory(
      admin,
      parentVariant.inventoryItem.id,
      levelEdge.node.location.id,
      availableBundles,
    );

    console.log(
      `Synced bundle ${bundle.id}: ${availableBundles} units available`,
    );
  } catch (e) {
    console.error(`Failed to sync inventory for bundle ${bundle.id}:`, e);
  }
}

/**
 * Full inventory reconciliation for a shop — syncs all fixed/custom bundles.
 * Used for periodic reconciliation or manual trigger from settings page.
 */
export async function fullInventorySync(
  admin: AdminApiContextWithoutRest["admin"],
  shopId: string,
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  try {
    const bundles = await getBundles(shopId, {});

    const eligibleBundles = bundles.filter(
      (b) => b.bundleType === "fixed" || b.bundleType === "custom",
    );

    for (const bundle of eligibleBundles) {
      try {
        await syncBundleInventory(admin, bundle);
        synced++;
      } catch (e) {
        console.error(`Failed to sync bundle ${bundle.id}:`, e);
        failed++;
      }
    }
  } catch (e) {
    console.error("Full inventory sync failed:", e);
  }

  return { synced, failed };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
