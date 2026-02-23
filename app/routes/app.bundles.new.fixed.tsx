import { useState, useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { getOrCreateShop } from "~/models/shop.server";
import { createBundle } from "~/models/bundle.server";
import { setComponents } from "~/models/bundle-component.server";
import { updateComponentPrices } from "~/models/bundle-component.server";
import {
  calculateProportionalPrices,
  calculateBundlePrice,
} from "~/services/pricing.server";
import { syncBundleMetafield } from "~/services/metafield-sync.server";
import { getBundle } from "~/models/bundle.server";

interface SelectedProduct {
  id: string;
  title: string;
  handle: string;
  images: Array<{ originalSrc: string }>;
}

interface SelectedVariant {
  id: string;
  title: string;
  price: string;
  sku: string;
  image?: { originalSrc: string };
  product: { id: string; title: string };
}

interface ComponentEntry {
  variantGid: string;
  productGid: string;
  variantTitle: string;
  productTitle: string;
  sku: string;
  imageUrl: string;
  originalPrice: number;
  quantity: number;
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

  // Create the bundle
  const bundle = await createBundle({
    shopId: shop.id,
    productGid: data.productGid,
    productTitle: data.productTitle,
    productHandle: data.productHandle,
    productImageUrl: data.productImageUrl,
    bundleType: "fixed",
    title: data.title,
    description: data.description,
    discountType: data.discountType,
    discountValue: data.discountValue,
    bundlePrice: data.bundlePrice,
    compareAtPrice: data.compareAtPrice,
  });

  // Save components
  await setComponents(
    bundle.id,
    data.components.map((c: ComponentEntry, i: number) => ({
      ...c,
      sortOrder: i,
      isFixed: true,
    })),
  );

  // Calculate and save proportional prices
  const effectivePrice = calculateBundlePrice(
    data.components,
    data.discountType,
    data.discountValue,
    data.bundlePrice,
  );
  const prices = calculateProportionalPrices(effectivePrice, data.components);
  await updateComponentPrices(bundle.id, prices.map((p) => ({
    variantGid: p.variantGid,
    pricePerUnit: p.pricePerUnit,
  })));

  // Sync metafield to Shopify
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

export default function NewFixedBundle() {
  const { shopId } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const navigate = useNavigate();

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [parentProduct, setParentProduct] = useState<SelectedProduct | null>(
    null,
  );
  const [components, setComponents] = useState<ComponentEntry[]>([]);
  const [discountType, setDiscountType] = useState("percentage");
  const [discountValue, setDiscountValue] = useState(0);
  const [saving, setSaving] = useState(false);

  // Computed values
  const totalOriginalPrice = components.reduce(
    (sum, c) => sum + c.originalPrice * c.quantity,
    0,
  );
  const effectivePrice = calculateBundlePrice(
    components,
    discountType,
    discountValue,
    discountType === "manual_price" ? discountValue : undefined,
  );
  const savings = totalOriginalPrice - effectivePrice;

  const selectParentProduct = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
    });
    if (selected && selected.length > 0) {
      const product = selected[0] as any;
      setParentProduct({
        id: product.id,
        title: product.title,
        handle: product.handle,
        images: product.images || [],
      });
      if (!title) {
        setTitle(product.title + " Bundle");
      }
    }
  }, [shopify, title]);

  const selectComponentVariants = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "variant",
      multiple: true,
    });
    if (selected) {
      const newComponents: ComponentEntry[] = (selected as any[]).map((v) => ({
        variantGid: v.id,
        productGid: v.product?.id || "",
        variantTitle: v.title || "Default",
        productTitle: v.product?.title || "",
        sku: v.sku || "",
        imageUrl: v.image?.originalSrc || "",
        originalPrice: parseFloat(v.price || "0"),
        quantity: 1,
      }));

      setComponents((prev) => {
        const existing = new Set(prev.map((c) => c.variantGid));
        const toAdd = newComponents.filter(
          (c) => !existing.has(c.variantGid),
        );
        return [...prev, ...toAdd];
      });
    }
  }, [shopify]);

  const updateQuantity = (variantGid: string, quantity: number) => {
    setComponents((prev) =>
      prev.map((c) =>
        c.variantGid === variantGid
          ? { ...c, quantity: Math.max(1, quantity) }
          : c,
      ),
    );
  };

  const removeComponent = (variantGid: string) => {
    setComponents((prev) => prev.filter((c) => c.variantGid !== variantGid));
  };

  const handleSave = async () => {
    if (!parentProduct || components.length === 0 || !title) {
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
        productGid: parentProduct.id,
        productTitle: parentProduct.title,
        productHandle: parentProduct.handle,
        productImageUrl: parentProduct.images?.[0]?.originalSrc || null,
        title,
        description,
        discountType,
        discountValue,
        bundlePrice:
          discountType === "manual_price" ? discountValue : effectivePrice,
        compareAtPrice: totalOriginalPrice,
        components,
      }),
    );

    submit(formData, { method: "POST" });
  };

  return (
    <s-page heading="Create Fixed Bundle" backAction={{ url: "/app/bundles/new" }}>
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
          {/* Bundle Info */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Bundle details</s-heading>
              <s-text-field
                label="Bundle name"
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

          {/* Parent Product */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Parent product</s-heading>
              <s-paragraph>
                This is the product customers will see and add to cart. It will
                be expanded into component items at checkout.
              </s-paragraph>
              {parentProduct ? (
                <s-stack direction="inline" gap="base" align="center">
                  {parentProduct.images?.[0]?.originalSrc && (
                    <s-thumbnail
                      source={parentProduct.images[0].originalSrc}
                      alt={parentProduct.title}
                      size="small"
                    />
                  )}
                  <s-text variant="bodyMd" fontWeight="semibold">
                    {parentProduct.title}
                  </s-text>
                  <s-button onClick={selectParentProduct} variant="tertiary">
                    Change
                  </s-button>
                </s-stack>
              ) : (
                <s-button onClick={selectParentProduct}>
                  Select parent product
                </s-button>
              )}
            </s-stack>
          </s-card>

          {/* Components */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" align="center">
                <s-heading>Components</s-heading>
                <s-button onClick={selectComponentVariants} size="slim">
                  Add variants
                </s-button>
              </s-stack>
              <s-paragraph>
                These are the actual products included in the bundle. Each will
                become a line item at checkout.
              </s-paragraph>

              {components.length === 0 ? (
                <s-box
                  padding="loose"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-text tone="subdued">
                    No components added yet. Click "Add variants" to select
                    products.
                  </s-text>
                </s-box>
              ) : (
                <s-stack direction="block" gap="tight">
                  {components.map((component) => (
                    <s-box
                      key={component.variantGid}
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                    >
                      <s-stack direction="inline" gap="base" align="center">
                        {component.imageUrl && (
                          <s-thumbnail
                            source={component.imageUrl}
                            alt={component.variantTitle}
                            size="small"
                          />
                        )}
                        <s-stack direction="block" gap="extraTight">
                          <s-text variant="bodyMd" fontWeight="semibold">
                            {component.productTitle}
                          </s-text>
                          <s-text variant="bodySm" tone="subdued">
                            {component.variantTitle}
                            {component.sku ? ` (${component.sku})` : ""}
                          </s-text>
                          <s-text variant="bodySm">
                            ${component.originalPrice.toFixed(2)} each
                          </s-text>
                        </s-stack>
                        <s-text-field
                          label="Qty"
                          type="number"
                          value={String(component.quantity)}
                          onChange={(e: any) =>
                            updateQuantity(
                              component.variantGid,
                              parseInt(e.target.value) || 1,
                            )
                          }
                          min="1"
                          autoComplete="off"
                          labelHidden
                        />
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          onClick={() => removeComponent(component.variantGid)}
                          size="slim"
                        >
                          Remove
                        </s-button>
                      </s-stack>
                    </s-box>
                  ))}
                </s-stack>
              )}
            </s-stack>
          </s-card>
        </s-layout-section>

        {/* Sidebar: Pricing */}
        <s-layout-section variant="oneThird">
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Pricing</s-heading>
              <s-select
                label="Discount type"
                value={discountType}
                onChange={(e: any) => setDiscountType(e.target.value)}
                options={[
                  { label: "Percentage off", value: "percentage" },
                  { label: "Fixed amount off", value: "fixed_amount" },
                  { label: "Manual price", value: "manual_price" },
                ]}
              />
              <s-text-field
                label={
                  discountType === "percentage"
                    ? "Discount (%)"
                    : discountType === "fixed_amount"
                      ? "Amount off ($)"
                      : "Bundle price ($)"
                }
                type="number"
                value={String(discountValue)}
                onChange={(e: any) =>
                  setDiscountValue(parseFloat(e.target.value) || 0)
                }
                min="0"
                step="0.01"
                autoComplete="off"
              />

              {components.length > 0 && (
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="tight">
                    <s-stack direction="inline" align="space-between">
                      <s-text tone="subdued">Original total:</s-text>
                      <s-text>${totalOriginalPrice.toFixed(2)}</s-text>
                    </s-stack>
                    <s-stack direction="inline" align="space-between">
                      <s-text tone="subdued">Bundle price:</s-text>
                      <s-text variant="headingMd">
                        ${effectivePrice.toFixed(2)}
                      </s-text>
                    </s-stack>
                    {savings > 0 && (
                      <s-stack direction="inline" align="space-between">
                        <s-text tone="subdued">Customer saves:</s-text>
                        <s-text tone="success">
                          ${savings.toFixed(2)} (
                          {((savings / totalOriginalPrice) * 100).toFixed(0)}%)
                        </s-text>
                      </s-stack>
                    )}
                  </s-stack>
                </s-box>
              )}
            </s-stack>
          </s-card>

          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Status</s-heading>
              <s-paragraph>
                Bundles are saved as draft. Activate them when ready to go live.
              </s-paragraph>
              <s-badge tone="attention">Draft</s-badge>
            </s-stack>
          </s-card>
        </s-layout-section>
      </s-layout>
    </s-page>
  );
}
