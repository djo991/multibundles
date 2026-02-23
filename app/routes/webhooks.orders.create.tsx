import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { syncBundleInventory } from "~/services/inventory.server";
import { getBundlesByComponentVariant } from "~/models/bundle.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} for shop ${shop}`);

  try {
    const order = payload as any;
    const lineItems: any[] = order?.line_items ?? [];

    // Collect all unique variant GIDs present in the order
    const variantGids = new Set<string>();
    for (const item of lineItems) {
      if (item.variant_id) {
        variantGids.add(`gid://shopify/ProductVariant/${item.variant_id}`);
      }
    }

    if (variantGids.size === 0) {
      return new Response();
    }

    // For each variant in the order, find bundles that contain it as a component
    // and recalculate their availability
    const processedBundleIds = new Set<string>();

    for (const variantGid of variantGids) {
      const bundles = await getBundlesByComponentVariant(variantGid);

      for (const bundle of bundles) {
        if (processedBundleIds.has(bundle.id)) continue;
        if (bundle.bundleType !== "fixed" && bundle.bundleType !== "custom") {
          continue;
        }

        processedBundleIds.add(bundle.id);
        await syncBundleInventory(admin, bundle);
      }
    }
  } catch (e) {
    console.error("Error processing orders/create webhook:", e);
  }

  return new Response();
};
