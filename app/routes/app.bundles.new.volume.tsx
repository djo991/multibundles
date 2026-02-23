import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { getOrCreateShop } from "~/models/shop.server";
import { createBundle, getBundle } from "~/models/bundle.server";
import { setVolumeTiers } from "~/models/volume-tier.server";
import { syncBundleMetafield } from "~/services/metafield-sync.server";

interface TierEntry {
  minQuantity: number;
  discountType: string;
  discountValue: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  return { shopId: shop.id };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const data = JSON.parse(formData.get("data") as string);

  const bundle = await createBundle({
    shopId: shop.id,
    productGid: data.productGid,
    productTitle: data.productTitle,
    productHandle: data.productHandle,
    productImageUrl: data.productImageUrl,
    bundleType: "volume",
    title: data.title,
    description: data.description,
    discountType: "percentage",
    discountValue: 0,
  });

  await setVolumeTiers(
    bundle.id,
    data.tiers.map((t: TierEntry, i: number) => ({ ...t, sortOrder: i })),
  );

  const fullBundle = await getBundle(bundle.id, shop.id);
  if (fullBundle) {
    try {
      await syncBundleMetafield(admin, fullBundle);
    } catch (e) {
      console.error("Metafield sync failed:", e);
    }
  }

  return { success: true, bundleId: bundle.id };
};

export default function NewVolumeBundle() {
  const shopify = useAppBridge();
  const submit = useSubmit();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetProduct, setTargetProduct] = useState<any>(null);
  const [tiers, setTiers] = useState<TierEntry[]>([
    { minQuantity: 2, discountType: "percentage", discountValue: 10 },
    { minQuantity: 3, discountType: "percentage", discountValue: 15 },
    { minQuantity: 5, discountType: "percentage", discountValue: 25 },
  ]);
  const [saving, setSaving] = useState(false);

  const selectProduct = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
    });
    if (selected && selected.length > 0) {
      const product = selected[0] as any;
      setTargetProduct(product);
      if (!title) setTitle(`${product.title} - Volume Discount`);
    }
  }, [shopify, title]);

  const addTier = () => {
    const lastTier = tiers[tiers.length - 1];
    setTiers([
      ...tiers,
      {
        minQuantity: (lastTier?.minQuantity || 1) + 2,
        discountType: "percentage",
        discountValue: (lastTier?.discountValue || 0) + 5,
      },
    ]);
  };

  const removeTier = (index: number) => {
    setTiers(tiers.filter((_, i) => i !== index));
  };

  const updateTier = (index: number, field: keyof TierEntry, value: any) => {
    setTiers(
      tiers.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
    );
  };

  const handleSave = async () => {
    if (!targetProduct || tiers.length === 0 || !title) {
      shopify.toast.show("Please fill in all required fields", {
        isError: true,
      });
      return;
    }

    setSaving(true);
    const formData = new FormData();
    formData.set(
      "data",
      JSON.stringify({
        productGid: targetProduct.id,
        productTitle: targetProduct.title,
        productHandle: targetProduct.handle,
        productImageUrl: targetProduct.images?.[0]?.originalSrc || null,
        title,
        description,
        tiers,
      }),
    );
    submit(formData, { method: "POST" });
  };

  return (
    <s-page
      heading="Create Volume / Tiered Bundle"
      backAction={{ url: "/app/bundles/new" }}
    >
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSave}
        {...(saving ? { loading: true } : {})}
      >
        Save bundle
      </s-button>

      <s-layout>
        <s-layout-section>
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Bundle details</s-heading>
              <s-text-field
                label="Name"
                value={title}
                onChange={(e: any) => setTitle(e.target.value)}
                autoComplete="off"
              />
              <s-text-field
                label="Description (optional)"
                value={description}
                onChange={(e: any) => setDescription(e.target.value)}
                multiline={3}
                autoComplete="off"
              />
            </s-stack>
          </s-card>

          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Target product</s-heading>
              <s-paragraph>
                The product that gets a volume discount. Customers buy more
                units of this product to unlock higher discount tiers.
              </s-paragraph>
              {targetProduct ? (
                <s-stack direction="inline" gap="base" align="center">
                  {targetProduct.images?.[0]?.originalSrc && (
                    <s-thumbnail
                      source={targetProduct.images[0].originalSrc}
                      alt={targetProduct.title}
                      size="small"
                    />
                  )}
                  <s-text variant="bodyMd" fontWeight="semibold">
                    {targetProduct.title}
                  </s-text>
                  <s-button onClick={selectProduct} variant="tertiary">
                    Change
                  </s-button>
                </s-stack>
              ) : (
                <s-button onClick={selectProduct}>Select product</s-button>
              )}
            </s-stack>
          </s-card>

          <s-card>
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" align="center">
                <s-heading>Discount tiers</s-heading>
                <s-button onClick={addTier} size="slim">
                  Add tier
                </s-button>
              </s-stack>
              <s-paragraph>
                Define quantity thresholds and their corresponding discounts.
                The highest qualifying tier applies.
              </s-paragraph>

              {tiers.map((tier, index) => (
                <s-box
                  key={index}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <s-stack direction="inline" gap="base" align="center">
                    <s-text-field
                      label="Buy at least"
                      type="number"
                      value={String(tier.minQuantity)}
                      onChange={(e: any) =>
                        updateTier(
                          index,
                          "minQuantity",
                          parseInt(e.target.value) || 1,
                        )
                      }
                      min="1"
                      autoComplete="off"
                    />
                    <s-select
                      label="Discount type"
                      value={tier.discountType}
                      onChange={(e: any) =>
                        updateTier(index, "discountType", e.target.value)
                      }
                      options={[
                        { label: "% off", value: "percentage" },
                        { label: "$ off each", value: "fixed_amount" },
                      ]}
                    />
                    <s-text-field
                      label={
                        tier.discountType === "percentage"
                          ? "Discount %"
                          : "$ off"
                      }
                      type="number"
                      value={String(tier.discountValue)}
                      onChange={(e: any) =>
                        updateTier(
                          index,
                          "discountValue",
                          parseFloat(e.target.value) || 0,
                        )
                      }
                      min="0"
                      step="0.01"
                      autoComplete="off"
                    />
                    {tiers.length > 1 && (
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => removeTier(index)}
                        size="slim"
                      >
                        Remove
                      </s-button>
                    )}
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          </s-card>
        </s-layout-section>

        <s-layout-section variant="oneThird">
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Preview</s-heading>
              <s-paragraph>
                How the tiers will appear to customers:
              </s-paragraph>
              {tiers
                .sort((a, b) => a.minQuantity - b.minQuantity)
                .map((tier, i) => (
                  <s-box
                    key={i}
                    padding="tight"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-text>
                      Buy {tier.minQuantity}+ →{" "}
                      <strong>
                        {tier.discountType === "percentage"
                          ? `${tier.discountValue}% off`
                          : `$${tier.discountValue.toFixed(2)} off each`}
                      </strong>
                    </s-text>
                  </s-box>
                ))}
            </s-stack>
          </s-card>

          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>How it works</s-heading>
              <s-paragraph>
                Volume discounts use a separate Discount Function (not Cart
                Transform). The product stays as a single line item in the cart
                - only the price changes based on quantity.
              </s-paragraph>
            </s-stack>
          </s-card>
        </s-layout-section>
      </s-layout>
    </s-page>
  );
}
