import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSubmit, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { getOrCreateShop } from "~/models/shop.server";
import {
  getBundle,
  updateBundle,
  deleteBundle,
} from "~/models/bundle.server";
import {
  setComponents,
  updateComponentPrices,
} from "~/models/bundle-component.server";
import {
  setSelectablePool,
  setSelectionRules,
} from "~/models/selectable-pool.server";
import { setVolumeTiers } from "~/models/volume-tier.server";
import {
  calculateProportionalPrices,
  calculateBundlePrice,
} from "~/services/pricing.server";
import { syncBundleMetafield } from "~/services/metafield-sync.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface TierEntry {
  minQuantity: number;
  discountType: string;
  discountValue: number;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const bundle = await getBundle(params.id!, shop.id);

  if (!bundle) {
    throw new Response("Bundle not found", { status: 404 });
  }

  return { bundle, shopId: shop.id };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const bundleId = params.id!;

  if (intent === "delete") {
    await deleteBundle(bundleId, shop.id);
    return redirect("/app/bundles");
  }

  if (intent === "activate") {
    await updateBundle(bundleId, shop.id, { status: "active" });
    const bundle = await getBundle(bundleId, shop.id);
    if (bundle) {
      try {
        await syncBundleMetafield(admin, bundle);
      } catch (e) {
        console.error("Metafield sync failed:", e);
      }
    }
    return { success: true };
  }

  if (intent === "deactivate") {
    await updateBundle(bundleId, shop.id, { status: "draft" });
    return { success: true };
  }

  // intent === "update"
  const data = JSON.parse(formData.get("data") as string);

  await updateBundle(bundleId, shop.id, {
    title: data.title,
    description: data.description,
    discountType: data.discountType,
    discountValue: data.discountValue,
    bundlePrice: data.bundlePrice,
    compareAtPrice: data.compareAtPrice,
  });

  // Update type-specific data
  if (data.bundleType === "fixed" && data.components) {
    await setComponents(
      bundleId,
      data.components.map((c: ComponentEntry, i: number) => ({
        ...c,
        sortOrder: i,
        isFixed: true,
      })),
    );
    const effectivePrice = calculateBundlePrice(
      data.components,
      data.discountType,
      data.discountValue,
      data.discountType === "manual_price" ? data.bundlePrice : undefined,
    );
    const prices = calculateProportionalPrices(effectivePrice, data.components);
    await updateComponentPrices(
      bundleId,
      prices.map((p) => ({
        variantGid: p.variantGid,
        pricePerUnit: p.pricePerUnit,
      })),
    );
  }

  if (data.bundleType === "mix_and_match" && data.pool) {
    await setSelectablePool(bundleId, data.pool);
    await setSelectionRules(bundleId, data.minSelections, data.maxSelections);
  }

  if (data.bundleType === "volume" && data.tiers) {
    await setVolumeTiers(
      bundleId,
      data.tiers.map((t: TierEntry, i: number) => ({ ...t, sortOrder: i })),
    );
  }

  if (data.bundleType === "custom") {
    if (data.fixedComponents) {
      const fixedComps = data.fixedComponents.map(
        (c: ComponentEntry, i: number) => ({
          ...c,
          sortOrder: i,
          isFixed: true,
        }),
      );
      const poolComps = (data.selectablePool || []).map(
        (c: PoolEntry, i: number) => ({
          ...c,
          quantity: 1,
          sortOrder: data.fixedComponents.length + i,
          isFixed: false,
        }),
      );
      await setComponents(bundleId, [...fixedComps, ...poolComps]);
    }
    if (data.minSelections !== undefined) {
      await setSelectionRules(
        bundleId,
        data.minSelections,
        data.maxSelections,
      );
    }
    if (data.fixedComponents && data.bundlePrice) {
      const prices = calculateProportionalPrices(
        data.bundlePrice,
        data.fixedComponents,
      );
      await updateComponentPrices(
        bundleId,
        prices.map((p) => ({
          variantGid: p.variantGid,
          pricePerUnit: p.pricePerUnit,
        })),
      );
    }
  }

  // Re-sync metafield
  const fullBundle = await getBundle(bundleId, shop.id);
  if (fullBundle) {
    try {
      await syncBundleMetafield(admin, fullBundle);
    } catch (e) {
      console.error("Metafield sync failed:", e);
    }
  }

  return { success: true };
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function EditBundle() {
  const { bundle } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const navigate = useNavigate();

  // Common state
  const [title, setTitle] = useState(bundle.title);
  const [description, setDescription] = useState(bundle.description || "");
  const [saving, setSaving] = useState(false);

  // Fixed bundle state
  const [components, setComponentsState] = useState<ComponentEntry[]>(
    bundle.components
      .filter((c) => c.isFixed)
      .map((c) => ({
        variantGid: c.variantGid,
        productGid: c.productGid,
        variantTitle: c.variantTitle,
        productTitle: c.productTitle,
        sku: c.sku || "",
        imageUrl: c.imageUrl || "",
        originalPrice: c.originalPrice,
        quantity: c.quantity,
      })),
  );
  const [discountType, setDiscountType] = useState(
    bundle.discountType || "percentage",
  );
  const [discountValue, setDiscountValue] = useState(
    bundle.discountValue || 0,
  );

  // Mix-and-match state
  const [pool, setPool] = useState<PoolEntry[]>(
    bundle.selectablePool.map((p) => ({
      variantGid: p.variantGid,
      productGid: p.productGid,
      variantTitle: p.variantTitle,
      productTitle: p.productTitle,
      imageUrl: p.imageUrl || "",
      originalPrice: p.originalPrice,
    })),
  );
  const [minSelections, setMinSelections] = useState(
    bundle.selectionRules?.minSelections || 3,
  );
  const [maxSelections, setMaxSelections] = useState(
    bundle.selectionRules?.maxSelections || 3,
  );
  const [bundlePrice, setBundlePrice] = useState(bundle.bundlePrice || 0);

  // Volume bundle state
  const [tiers, setTiers] = useState<TierEntry[]>(
    bundle.volumeTiers.map((t) => ({
      minQuantity: t.minQuantity,
      discountType: t.discountType,
      discountValue: t.discountValue,
    })),
  );

  // Custom bundle state
  const [fixedComponents, setFixedComponents] = useState<ComponentEntry[]>(
    bundle.components
      .filter((c) => c.isFixed)
      .map((c) => ({
        variantGid: c.variantGid,
        productGid: c.productGid,
        variantTitle: c.variantTitle,
        productTitle: c.productTitle,
        sku: c.sku || "",
        imageUrl: c.imageUrl || "",
        originalPrice: c.originalPrice,
        quantity: c.quantity,
      })),
  );
  const [customPool, setCustomPool] = useState<PoolEntry[]>(
    bundle.components
      .filter((c) => !c.isFixed)
      .map((c) => ({
        variantGid: c.variantGid,
        productGid: c.productGid,
        variantTitle: c.variantTitle,
        productTitle: c.productTitle,
        imageUrl: c.imageUrl || "",
        originalPrice: c.originalPrice,
      })),
  );

  // Resource pickers
  const selectComponentVariants = useCallback(
    async (
      setter: React.Dispatch<React.SetStateAction<ComponentEntry[]>>,
    ) => {
      const selected = await shopify.resourcePicker({
        type: "variant",
        multiple: true,
      });
      if (selected) {
        const newComponents: ComponentEntry[] = (selected as any[]).map(
          (v) => ({
            variantGid: v.id,
            productGid: v.product?.id || "",
            variantTitle: v.title || "Default",
            productTitle: v.product?.title || "",
            sku: v.sku || "",
            imageUrl: v.image?.originalSrc || "",
            originalPrice: parseFloat(v.price || "0"),
            quantity: 1,
          }),
        );
        setter((prev) => {
          const existing = new Set(prev.map((c) => c.variantGid));
          return [...prev, ...newComponents.filter((c) => !existing.has(c.variantGid))];
        });
      }
    },
    [shopify],
  );

  const selectPoolVariants = useCallback(
    async (setter: React.Dispatch<React.SetStateAction<PoolEntry[]>>) => {
      const selected = await shopify.resourcePicker({
        type: "variant",
        multiple: true,
      });
      if (selected) {
        const newEntries: PoolEntry[] = (selected as any[]).map((v) => ({
          variantGid: v.id,
          productGid: v.product?.id || "",
          variantTitle: v.title || "Default",
          productTitle: v.product?.title || "",
          imageUrl: v.image?.originalSrc || "",
          originalPrice: parseFloat(v.price || "0"),
        }));
        setter((prev) => {
          const existing = new Set(prev.map((p) => p.variantGid));
          return [...prev, ...newEntries.filter((e) => !existing.has(e.variantGid))];
        });
      }
    },
    [shopify],
  );

  // Computed values for fixed bundles
  const totalOriginalPrice = components.reduce(
    (s, c) => s + c.originalPrice * c.quantity,
    0,
  );
  const effectivePrice = calculateBundlePrice(
    components,
    discountType,
    discountValue,
    discountType === "manual_price" ? discountValue : undefined,
  );
  const savings = totalOriginalPrice - effectivePrice;

  // Save handler
  const handleSave = () => {
    if (!title) {
      shopify.toast.show("Bundle name is required", { isError: true });
      return;
    }
    setSaving(true);

    const baseData: Record<string, unknown> = {
      title,
      description,
      bundleType: bundle.bundleType,
    };

    if (bundle.bundleType === "fixed") {
      if (components.length === 0) {
        shopify.toast.show("Add at least one component", { isError: true });
        setSaving(false);
        return;
      }
      Object.assign(baseData, {
        discountType,
        discountValue,
        bundlePrice: discountType === "manual_price" ? discountValue : effectivePrice,
        compareAtPrice: totalOriginalPrice,
        components,
      });
    } else if (bundle.bundleType === "mix_and_match") {
      Object.assign(baseData, {
        bundlePrice,
        compareAtPrice: 0,
        pool,
        minSelections,
        maxSelections,
        discountType: "manual_price",
        discountValue: 0,
      });
    } else if (bundle.bundleType === "volume") {
      Object.assign(baseData, {
        tiers,
        discountType: "percentage",
        discountValue: 0,
      });
    } else if (bundle.bundleType === "custom") {
      Object.assign(baseData, {
        fixedComponents,
        selectablePool: customPool,
        minSelections,
        maxSelections,
        bundlePrice,
        compareAtPrice: 0,
        discountType: "manual_price",
        discountValue: 0,
      });
    }

    const formData = new FormData();
    formData.set("intent", "update");
    formData.set("data", JSON.stringify(baseData));
    submit(formData, { method: "POST" });
  };

  const handleActivate = () => {
    const formData = new FormData();
    formData.set("intent", "activate");
    submit(formData, { method: "POST" });
  };

  const handleDeactivate = () => {
    const formData = new FormData();
    formData.set("intent", "deactivate");
    submit(formData, { method: "POST" });
  };

  const handleDelete = () => {
    if (!window.confirm("Delete this bundle? This cannot be undone.")) return;
    const formData = new FormData();
    formData.set("intent", "delete");
    submit(formData, { method: "POST" });
  };

  const bundleTypeLabel: Record<string, string> = {
    fixed: "Fixed Bundle",
    mix_and_match: "Mix & Match Bundle",
    volume: "Volume / Tiered Bundle",
    custom: "Custom Bundle",
  };

  const statusTone: Record<string, string> = {
    active: "success",
    draft: "attention",
    archived: "info",
  };

  return (
    <s-page
      heading={title || "Edit Bundle"}
      backAction={{ url: "/app/bundles" }}
    >
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSave}
        {...(saving ? { loading: true } : {})}
      >
        Save
      </s-button>

      <s-layout>
        <s-layout-section>
          {/* Bundle details */}
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

          {/* Fixed bundle components */}
          {bundle.bundleType === "fixed" && (
            <s-card>
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base" align="center">
                  <s-heading>Components</s-heading>
                  <s-button
                    onClick={() => selectComponentVariants(setComponentsState)}
                    size="slim"
                  >
                    Add variants
                  </s-button>
                </s-stack>
                {components.length === 0 ? (
                  <s-box
                    padding="loose"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-text tone="subdued">No components yet.</s-text>
                  </s-box>
                ) : (
                  <s-stack direction="block" gap="tight">
                    {components.map((c) => (
                      <s-box
                        key={c.variantGid}
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                      >
                        <s-stack direction="inline" gap="base" align="center">
                          {c.imageUrl && (
                            <s-thumbnail
                              source={c.imageUrl}
                              alt={c.variantTitle}
                              size="small"
                            />
                          )}
                          <s-stack direction="block" gap="extraTight">
                            <s-text fontWeight="semibold">
                              {c.productTitle}
                            </s-text>
                            <s-text variant="bodySm" tone="subdued">
                              {c.variantTitle} — ${c.originalPrice.toFixed(2)}
                            </s-text>
                          </s-stack>
                          <s-text-field
                            label="Qty"
                            type="number"
                            value={String(c.quantity)}
                            onChange={(e: any) =>
                              setComponentsState((prev) =>
                                prev.map((comp) =>
                                  comp.variantGid === c.variantGid
                                    ? {
                                        ...comp,
                                        quantity:
                                          parseInt(e.target.value) || 1,
                                      }
                                    : comp,
                                ),
                              )
                            }
                            min="1"
                            autoComplete="off"
                            labelHidden
                          />
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            onClick={() =>
                              setComponentsState((prev) =>
                                prev.filter(
                                  (comp) => comp.variantGid !== c.variantGid,
                                ),
                              )
                            }
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
          )}

          {/* Mix-and-match pool */}
          {bundle.bundleType === "mix_and_match" && (
            <s-card>
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base" align="center">
                  <s-heading>Selection pool</s-heading>
                  <s-button
                    onClick={() => selectPoolVariants(setPool)}
                    size="slim"
                  >
                    Add variants
                  </s-button>
                </s-stack>
                {pool.length === 0 ? (
                  <s-box
                    padding="loose"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-text tone="subdued">No pool items yet.</s-text>
                  </s-box>
                ) : (
                  <s-stack direction="block" gap="tight">
                    {pool.map((item) => (
                      <s-box
                        key={item.variantGid}
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                      >
                        <s-stack direction="inline" gap="base" align="center">
                          {item.imageUrl && (
                            <s-thumbnail
                              source={item.imageUrl}
                              alt={item.variantTitle}
                              size="small"
                            />
                          )}
                          <s-stack direction="block" gap="extraTight">
                            <s-text fontWeight="semibold">
                              {item.productTitle}
                            </s-text>
                            <s-text variant="bodySm" tone="subdued">
                              {item.variantTitle} — $
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
                    ))}
                  </s-stack>
                )}
              </s-stack>
            </s-card>
          )}

          {/* Volume tiers */}
          {bundle.bundleType === "volume" && (
            <s-card>
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base" align="center">
                  <s-heading>Discount tiers</s-heading>
                  <s-button
                    onClick={() => {
                      const last = tiers[tiers.length - 1];
                      setTiers([
                        ...tiers,
                        {
                          minQuantity: (last?.minQuantity || 1) + 2,
                          discountType: "percentage",
                          discountValue: (last?.discountValue || 0) + 5,
                        },
                      ]);
                    }}
                    size="slim"
                  >
                    Add tier
                  </s-button>
                </s-stack>
                {tiers.map((tier, i) => (
                  <s-box
                    key={i}
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
                          setTiers((prev) =>
                            prev.map((t, idx) =>
                              idx === i
                                ? {
                                    ...t,
                                    minQuantity:
                                      parseInt(e.target.value) || 1,
                                  }
                                : t,
                            ),
                          )
                        }
                        min="1"
                        autoComplete="off"
                      />
                      <s-select
                        label="Type"
                        value={tier.discountType}
                        onChange={(e: any) =>
                          setTiers((prev) =>
                            prev.map((t, idx) =>
                              idx === i
                                ? { ...t, discountType: e.target.value }
                                : t,
                            ),
                          )
                        }
                        options={[
                          { label: "% off", value: "percentage" },
                          { label: "$ off each", value: "fixed_amount" },
                        ]}
                      />
                      <s-text-field
                        label={
                          tier.discountType === "percentage" ? "%" : "$ off"
                        }
                        type="number"
                        value={String(tier.discountValue)}
                        onChange={(e: any) =>
                          setTiers((prev) =>
                            prev.map((t, idx) =>
                              idx === i
                                ? {
                                    ...t,
                                    discountValue:
                                      parseFloat(e.target.value) || 0,
                                  }
                                : t,
                            ),
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
                          onClick={() =>
                            setTiers((prev) => prev.filter((_, idx) => idx !== i))
                          }
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
          )}

          {/* Custom bundle */}
          {bundle.bundleType === "custom" && (
            <>
              <s-card>
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base" align="center">
                    <s-heading>Fixed components</s-heading>
                    <s-button
                      onClick={() =>
                        selectComponentVariants(setFixedComponents)
                      }
                      size="slim"
                    >
                      Add variants
                    </s-button>
                  </s-stack>
                  <s-paragraph>
                    Always included — customers cannot remove these.
                  </s-paragraph>
                  {fixedComponents.length === 0 ? (
                    <s-box
                      padding="loose"
                      borderWidth="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <s-text tone="subdued">No fixed components yet.</s-text>
                    </s-box>
                  ) : (
                    <s-stack direction="block" gap="tight">
                      {fixedComponents.map((c) => (
                        <s-box
                          key={c.variantGid}
                          padding="base"
                          borderWidth="base"
                          borderRadius="base"
                        >
                          <s-stack direction="inline" gap="base" align="center">
                            <s-stack direction="block" gap="extraTight">
                              <s-text fontWeight="semibold">
                                {c.productTitle}
                              </s-text>
                              <s-text variant="bodySm" tone="subdued">
                                {c.variantTitle} — $
                                {c.originalPrice.toFixed(2)}
                              </s-text>
                            </s-stack>
                            <s-text-field
                              label="Qty"
                              type="number"
                              value={String(c.quantity)}
                              onChange={(e: any) =>
                                setFixedComponents((prev) =>
                                  prev.map((comp) =>
                                    comp.variantGid === c.variantGid
                                      ? {
                                          ...comp,
                                          quantity:
                                            parseInt(e.target.value) || 1,
                                        }
                                      : comp,
                                  ),
                                )
                              }
                              min="1"
                              autoComplete="off"
                              labelHidden
                            />
                            <s-button
                              variant="tertiary"
                              tone="critical"
                              onClick={() =>
                                setFixedComponents((prev) =>
                                  prev.filter(
                                    (comp) => comp.variantGid !== c.variantGid,
                                  ),
                                )
                              }
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

              <s-card>
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base" align="center">
                    <s-heading>Selectable pool</s-heading>
                    <s-button
                      onClick={() => selectPoolVariants(setCustomPool)}
                      size="slim"
                    >
                      Add variants
                    </s-button>
                  </s-stack>
                  <s-paragraph>
                    Customers choose from these items to complete their bundle.
                  </s-paragraph>
                  {customPool.length === 0 ? (
                    <s-box
                      padding="loose"
                      borderWidth="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <s-text tone="subdued">No pool items yet.</s-text>
                    </s-box>
                  ) : (
                    <s-stack direction="block" gap="tight">
                      {customPool.map((item) => (
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
                                {item.variantTitle} — $
                                {item.originalPrice.toFixed(2)}
                              </s-text>
                            </s-stack>
                            <s-button
                              variant="tertiary"
                              tone="critical"
                              onClick={() =>
                                setCustomPool((prev) =>
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
                      ))}
                    </s-stack>
                  )}
                </s-stack>
              </s-card>
            </>
          )}
        </s-layout-section>

        {/* Sidebar */}
        <s-layout-section variant="oneThird">
          {/* Status card */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Status</s-heading>
              <s-badge tone={statusTone[bundle.status] || "info"}>
                {bundle.status.charAt(0).toUpperCase() +
                  bundle.status.slice(1)}
              </s-badge>
              <s-badge>{bundleTypeLabel[bundle.bundleType] || bundle.bundleType}</s-badge>
              {!bundle.metafieldSynced && (
                <s-banner tone="warning">
                  <s-paragraph>Metafield out of sync. Save to re-sync.</s-paragraph>
                </s-banner>
              )}
              <s-stack direction="block" gap="tight">
                {bundle.status === "draft" ? (
                  <s-button onClick={handleActivate} variant="primary">
                    Activate bundle
                  </s-button>
                ) : (
                  <s-button onClick={handleDeactivate}>
                    Deactivate (set to draft)
                  </s-button>
                )}
              </s-stack>
            </s-stack>
          </s-card>

          {/* Pricing sidebar for fixed bundles */}
          {bundle.bundleType === "fixed" && (
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
                        <s-text tone="subdued">Original:</s-text>
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
                            {(
                              (savings / totalOriginalPrice) *
                              100
                            ).toFixed(0)}
                            %)
                          </s-text>
                        </s-stack>
                      )}
                    </s-stack>
                  </s-box>
                )}
              </s-stack>
            </s-card>
          )}

          {/* Pricing sidebar for mix-and-match */}
          {bundle.bundleType === "mix_and_match" && (
            <s-card>
              <s-stack direction="block" gap="base">
                <s-heading>Selection rules</s-heading>
                <s-text-field
                  label="Min items"
                  type="number"
                  value={String(minSelections)}
                  onChange={(e: any) =>
                    setMinSelections(parseInt(e.target.value) || 1)
                  }
                  min="1"
                  autoComplete="off"
                />
                <s-text-field
                  label="Max items"
                  type="number"
                  value={String(maxSelections)}
                  onChange={(e: any) =>
                    setMaxSelections(parseInt(e.target.value) || 1)
                  }
                  min="1"
                  autoComplete="off"
                />
                <s-heading>Bundle price</s-heading>
                <s-text-field
                  label="Price ($)"
                  type="number"
                  value={String(bundlePrice)}
                  onChange={(e: any) =>
                    setBundlePrice(parseFloat(e.target.value) || 0)
                  }
                  min="0"
                  step="0.01"
                  autoComplete="off"
                />
              </s-stack>
            </s-card>
          )}

          {/* Pricing sidebar for custom bundles */}
          {bundle.bundleType === "custom" && (
            <s-card>
              <s-stack direction="block" gap="base">
                <s-heading>Selection rules</s-heading>
                <s-text-field
                  label="Min customer picks"
                  type="number"
                  value={String(minSelections)}
                  onChange={(e: any) =>
                    setMinSelections(parseInt(e.target.value) || 1)
                  }
                  min="1"
                  autoComplete="off"
                />
                <s-text-field
                  label="Max customer picks"
                  type="number"
                  value={String(maxSelections)}
                  onChange={(e: any) =>
                    setMaxSelections(parseInt(e.target.value) || 1)
                  }
                  min="1"
                  autoComplete="off"
                />
                <s-heading>Bundle price</s-heading>
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
              </s-stack>
            </s-card>
          )}

          {/* Product info */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Linked product</s-heading>
              {bundle.productImageUrl && (
                <s-thumbnail
                  source={bundle.productImageUrl}
                  alt={bundle.productTitle}
                  size="small"
                />
              )}
              <s-text variant="bodyMd" fontWeight="semibold">
                {bundle.productTitle}
              </s-text>
              <s-text variant="bodySm" tone="subdued">
                {bundle.productGid}
              </s-text>
            </s-stack>
          </s-card>

          {/* Danger zone */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Danger zone</s-heading>
              <s-button
                variant="tertiary"
                tone="critical"
                onClick={handleDelete}
              >
                Delete bundle
              </s-button>
            </s-stack>
          </s-card>
        </s-layout-section>
      </s-layout>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
