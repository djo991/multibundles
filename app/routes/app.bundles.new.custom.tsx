import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { getOrCreateShop } from "~/models/shop.server";
import { createBundle, getBundle } from "~/models/bundle.server";
import { setComponents } from "~/models/bundle-component.server";
import { setSelectablePool, setSelectionRules } from "~/models/selectable-pool.server";
import { updateComponentPrices } from "~/models/bundle-component.server";
import { calculateProportionalPrices } from "~/services/pricing.server";
import { syncBundleMetafield } from "~/services/metafield-sync.server";

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

interface PoolEntry {
  variantGid: string;
  productGid: string;
  variantTitle: string;
  productTitle: string;
  imageUrl: string;
  originalPrice: number;
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
    bundleType: "custom",
    title: data.title,
    description: data.description,
    discountType: "manual_price",
    discountValue: 0,
    bundlePrice: data.bundlePrice,
    compareAtPrice: data.compareAtPrice,
  });

  // Save fixed components
  await setComponents(
    bundle.id,
    data.fixedComponents.map((c: ComponentEntry, i: number) => ({
      ...c,
      sortOrder: i,
      isFixed: true,
    })),
  );

  // Save selectable pool
  await setSelectablePool(bundle.id, data.pool);
  await setSelectionRules(bundle.id, data.minSelections, data.maxSelections);

  // Calculate proportional prices for fixed components
  if (data.bundlePrice > 0 && data.fixedComponents.length > 0) {
    const prices = calculateProportionalPrices(
      data.bundlePrice,
      data.fixedComponents,
    );
    await updateComponentPrices(
      bundle.id,
      prices.map((p) => ({
        variantGid: p.variantGid,
        pricePerUnit: p.pricePerUnit,
      })),
    );
  }

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

export default function NewCustomBundle() {
  const shopify = useAppBridge();
  const submit = useSubmit();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [parentProduct, setParentProduct] = useState<any>(null);
  const [fixedComponents, setFixedComponents] = useState<ComponentEntry[]>([]);
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [minSelections, setMinSelections] = useState(2);
  const [maxSelections, setMaxSelections] = useState(2);
  const [bundlePrice, setBundlePrice] = useState(0);
  const [saving, setSaving] = useState(false);

  const selectParentProduct = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
    });
    if (selected && selected.length > 0) {
      const product = selected[0] as any;
      setParentProduct(product);
      if (!title) setTitle(product.title);
    }
  }, [shopify, title]);

  const addFixedComponents = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "variant",
      multiple: true,
    });
    if (selected) {
      const entries: ComponentEntry[] = (selected as any[]).map((v) => ({
        variantGid: v.id,
        productGid: v.product?.id || "",
        variantTitle: v.title || "Default",
        productTitle: v.product?.title || "",
        sku: v.sku || "",
        imageUrl: v.image?.originalSrc || "",
        originalPrice: parseFloat(v.price || "0"),
        quantity: 1,
      }));
      setFixedComponents((prev) => {
        const existing = new Set(prev.map((c) => c.variantGid));
        return [...prev, ...entries.filter((e) => !existing.has(e.variantGid))];
      });
    }
  }, [shopify]);

  const addToPool = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "variant",
      multiple: true,
    });
    if (selected) {
      const entries: PoolEntry[] = (selected as any[]).map((v) => ({
        variantGid: v.id,
        productGid: v.product?.id || "",
        variantTitle: v.title || "Default",
        productTitle: v.product?.title || "",
        imageUrl: v.image?.originalSrc || "",
        originalPrice: parseFloat(v.price || "0"),
      }));
      setPool((prev) => {
        const existing = new Set(prev.map((p) => p.variantGid));
        return [...prev, ...entries.filter((e) => !existing.has(e.variantGid))];
      });
    }
  }, [shopify]);

  const fixedTotal = fixedComponents.reduce(
    (s, c) => s + c.originalPrice * c.quantity,
    0,
  );
  const avgPoolPrice =
    pool.length > 0
      ? pool.reduce((s, p) => s + p.originalPrice, 0) / pool.length
      : 0;
  const compareAtPrice = fixedTotal + avgPoolPrice * maxSelections;

  const handleSave = async () => {
    if (
      !parentProduct ||
      fixedComponents.length === 0 ||
      pool.length === 0 ||
      !title ||
      bundlePrice <= 0
    ) {
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
        bundlePrice,
        compareAtPrice,
        fixedComponents,
        pool,
        minSelections,
        maxSelections,
      }),
    );
    submit(formData, { method: "POST" });
  };

  return (
    <s-page
      heading="Create Custom Bundle"
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

          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Parent product</s-heading>
              {parentProduct ? (
                <s-stack direction="inline" gap="base" align="center">
                  <s-text fontWeight="semibold">{parentProduct.title}</s-text>
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

          {/* Fixed Components */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" align="center">
                <s-heading>Fixed components (always included)</s-heading>
                <s-button onClick={addFixedComponents} size="slim">
                  Add variants
                </s-button>
              </s-stack>
              <s-paragraph>
                These items are always part of the bundle - customers cannot
                remove them.
              </s-paragraph>

              {fixedComponents.length === 0 ? (
                <s-box
                  padding="loose"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-text tone="subdued">No fixed components added.</s-text>
                </s-box>
              ) : (
                fixedComponents.map((c) => (
                  <s-box
                    key={c.variantGid}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                  >
                    <s-stack direction="inline" gap="base" align="center">
                      <s-stack direction="block" gap="extraTight">
                        <s-text fontWeight="semibold">{c.productTitle}</s-text>
                        <s-text variant="bodySm" tone="subdued">
                          {c.variantTitle} - ${c.originalPrice.toFixed(2)}
                        </s-text>
                      </s-stack>
                      <s-text-field
                        label="Qty"
                        type="number"
                        value={String(c.quantity)}
                        onChange={(e: any) => {
                          const qty = parseInt(e.target.value) || 1;
                          setFixedComponents((prev) =>
                            prev.map((x) =>
                              x.variantGid === c.variantGid
                                ? { ...x, quantity: Math.max(1, qty) }
                                : x,
                            ),
                          );
                        }}
                        min="1"
                        autoComplete="off"
                        labelHidden
                      />
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() =>
                          setFixedComponents((prev) =>
                            prev.filter((x) => x.variantGid !== c.variantGid),
                          )
                        }
                        size="slim"
                      >
                        Remove
                      </s-button>
                    </s-stack>
                  </s-box>
                ))
              )}
            </s-stack>
          </s-card>

          {/* Selectable Pool */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" align="center">
                <s-heading>Selectable items (customer chooses)</s-heading>
                <s-button onClick={addToPool} size="slim">
                  Add variants
                </s-button>
              </s-stack>
              <s-paragraph>
                Customers pick from these items to complete their bundle.
              </s-paragraph>

              {pool.length === 0 ? (
                <s-box
                  padding="loose"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-text tone="subdued">No selectable items added.</s-text>
                </s-box>
              ) : (
                pool.map((item) => (
                  <s-box
                    key={item.variantGid}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                  >
                    <s-stack direction="inline" gap="base" align="center">
                      <s-stack direction="block" gap="extraTight">
                        <s-text fontWeight="semibold">
                          {item.productTitle}
                        </s-text>
                        <s-text variant="bodySm" tone="subdued">
                          {item.variantTitle} - $
                          {item.originalPrice.toFixed(2)}
                        </s-text>
                      </s-stack>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() =>
                          setPool((prev) =>
                            prev.filter(
                              (p) => p.variantGid !== item.variantGid,
                            ),
                          )
                        }
                        size="slim"
                      >
                        Remove
                      </s-button>
                    </s-stack>
                  </s-box>
                ))
              )}
            </s-stack>
          </s-card>
        </s-layout-section>

        <s-layout-section variant="oneThird">
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Selection rules</s-heading>
              <s-text-field
                label="Min items to pick"
                type="number"
                value={String(minSelections)}
                onChange={(e: any) =>
                  setMinSelections(parseInt(e.target.value) || 1)
                }
                min="1"
                autoComplete="off"
              />
              <s-text-field
                label="Max items to pick"
                type="number"
                value={String(maxSelections)}
                onChange={(e: any) =>
                  setMaxSelections(parseInt(e.target.value) || 1)
                }
                min="1"
                autoComplete="off"
              />
            </s-stack>
          </s-card>

          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Pricing</s-heading>
              <s-text-field
                label="Total bundle price ($)"
                type="number"
                value={String(bundlePrice)}
                onChange={(e: any) =>
                  setBundlePrice(parseFloat(e.target.value) || 0)
                }
                min="0"
                step="0.01"
                autoComplete="off"
              />
              {bundlePrice > 0 && (
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="tight">
                    <s-stack direction="inline" align="space-between">
                      <s-text tone="subdued">Fixed items value:</s-text>
                      <s-text>${fixedTotal.toFixed(2)}</s-text>
                    </s-stack>
                    <s-stack direction="inline" align="space-between">
                      <s-text tone="subdued">Estimated total value:</s-text>
                      <s-text>${compareAtPrice.toFixed(2)}</s-text>
                    </s-stack>
                    <s-stack direction="inline" align="space-between">
                      <s-text tone="subdued">Bundle price:</s-text>
                      <s-text variant="headingMd">
                        ${bundlePrice.toFixed(2)}
                      </s-text>
                    </s-stack>
                  </s-stack>
                </s-box>
              )}
            </s-stack>
          </s-card>
        </s-layout-section>
      </s-layout>
    </s-page>
  );
}
