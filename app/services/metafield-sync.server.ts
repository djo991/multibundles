import { METAFIELDS_SET } from "~/graphql/metafield-mutations";
import { markBundleSynced, type BundleWithRelations } from "~/models/bundle.server";

const METAFIELD_NAMESPACE = "$app:multibundles";
const BUNDLE_CONFIG_KEY = "bundle-config";
const VOLUME_CONFIG_KEY = "volume-config";

/**
 * Build the metafield JSON for a bundle based on its type and sync it to Shopify.
 */
export async function syncBundleMetafield(
  admin: { graphql: Function },
  bundle: BundleWithRelations,
) {
  const isVolume = bundle.bundleType === "volume";
  const key = isVolume ? VOLUME_CONFIG_KEY : BUNDLE_CONFIG_KEY;
  const value = isVolume
    ? buildVolumeConfig(bundle)
    : buildBundleConfig(bundle);

  const response = await admin.graphql(METAFIELDS_SET, {
    variables: {
      metafields: [
        {
          ownerId: bundle.productGid,
          namespace: METAFIELD_NAMESPACE,
          key,
          type: "json",
          value: JSON.stringify(value),
        },
      ],
    },
  });

  const json = await response.json();
  const errors = json.data?.metafieldsSet?.userErrors;

  if (errors && errors.length > 0) {
    throw new Error(
      `Metafield sync failed: ${errors.map((e: any) => e.message).join(", ")}`,
    );
  }

  await markBundleSynced(bundle.id);
  return json.data.metafieldsSet.metafields;
}

function buildBundleConfig(bundle: BundleWithRelations) {
  switch (bundle.bundleType) {
    case "fixed":
      return {
        type: "fixed",
        components: bundle.components.map((c) => ({
          variantId: c.variantGid,
          quantity: c.quantity,
          price: c.pricePerUnit?.toFixed(2) ?? "0.00",
        })),
      };

    case "mix_and_match":
      return {
        type: "mix_and_match",
        minSelections: bundle.selectionRules?.minSelections ?? 1,
        maxSelections: bundle.selectionRules?.maxSelections ?? 1,
        pool: bundle.selectablePool.map((p) => ({
          variantId: p.variantGid,
          price: p.originalPrice?.toFixed(2) ?? "0.00",
        })),
        bundlePrice: bundle.bundlePrice?.toFixed(2) ?? "0.00",
      };

    case "custom":
      return {
        type: "custom",
        fixedComponents: bundle.components
          .filter((c) => c.isFixed)
          .map((c) => ({
            variantId: c.variantGid,
            quantity: c.quantity,
            price: c.pricePerUnit?.toFixed(2) ?? "0.00",
          })),
        selectablePool: {
          minSelections: bundle.selectionRules?.minSelections ?? 1,
          maxSelections: bundle.selectionRules?.maxSelections ?? 1,
          pool: bundle.selectablePool.map((p) => ({
            variantId: p.variantGid,
            price: p.originalPrice?.toFixed(2) ?? "0.00",
          })),
        },
        bundlePrice: bundle.bundlePrice?.toFixed(2) ?? "0.00",
      };

    default:
      throw new Error(`Unknown bundle type: ${bundle.bundleType}`);
  }
}

function buildVolumeConfig(bundle: BundleWithRelations) {
  return {
    type: "volume",
    tiers: bundle.volumeTiers.map((t) => ({
      minQuantity: t.minQuantity,
      discountType: t.discountType,
      discountValue: t.discountValue,
    })),
  };
}
