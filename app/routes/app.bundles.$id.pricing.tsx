import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { authenticate } from "~/shopify.server";
import { getOrCreateShop } from "~/models/shop.server";
import { getBundle } from "~/models/bundle.server";
import { getMarketOverrides } from "~/models/market-override.server";
import {
  fetchMarkets,
  applyMarketPriceOverride,
  removeMarketPriceOverride,
} from "~/services/market-pricing.server";
import { canAccessFeature } from "~/services/plan-gating.server";
import { applyRoundingRule } from "~/services/pricing.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  // Check plan gating
  const canUseMultiMarket = canAccessFeature(shop.activePlan, "multiMarket");

  const bundle = await getBundle(params.id!, shop.id);
  if (!bundle) {
    throw new Response("Bundle not found", { status: 404 });
  }

  let markets: any[] = [];
  let existingOverrides: any[] = [];

  if (canUseMultiMarket) {
    const { admin } = await authenticate.admin(request);
    markets = await fetchMarkets(admin);
    existingOverrides = await getMarketOverrides(bundle.id);
  }

  return {
    bundle: {
      id: bundle.id,
      title: bundle.title,
      bundlePrice: bundle.bundlePrice,
      productGid: bundle.productGid,
    },
    markets: markets.filter((m) => !m.primary && m.enabled),
    existingOverrides,
    canUseMultiMarket,
    activePlan: shop.activePlan,
  };
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const canUseMultiMarket = canAccessFeature(shop.activePlan, "multiMarket");
  if (!canUseMultiMarket) {
    return { error: "Multi-market pricing requires the Global plan." };
  }

  const bundle = await getBundle(params.id!, shop.id);
  if (!bundle) {
    return { error: "Bundle not found" };
  }

  if (intent === "set_override") {
    const data = JSON.parse(formData.get("data") as string);

    // Fetch the parent product's first variant GID
    const variantResponse = await admin.graphql(
      `#graphql
      query GetFirstVariant($id: ID!) {
        product(id: $id) {
          variants(first: 1) {
            edges {
              node { id }
            }
          }
        }
      }`,
      { variables: { id: bundle.productGid } },
    );
    const variantJson = await variantResponse.json();
    const parentVariantGid =
      variantJson.data?.product?.variants?.edges?.[0]?.node?.id;

    if (!parentVariantGid) {
      return { error: "Could not find parent variant" };
    }

    const result = await applyMarketPriceOverride(
      admin,
      bundle.id,
      parentVariantGid,
      data.marketId,
      data.marketName,
      data.currencyCode,
      data.rawPrice,
      data.roundingRule,
    );

    return result;
  }

  if (intent === "remove_override") {
    const marketId = formData.get("marketId") as string;

    const variantResponse = await admin.graphql(
      `#graphql
      query GetFirstVariant($id: ID!) {
        product(id: $id) {
          variants(first: 1) {
            edges {
              node { id }
            }
          }
        }
      }`,
      { variables: { id: bundle.productGid } },
    );
    const variantJson = await variantResponse.json();
    const parentVariantGid =
      variantJson.data?.product?.variants?.edges?.[0]?.node?.id;

    if (!parentVariantGid) {
      return { error: "Could not find parent variant" };
    }

    const result = await removeMarketPriceOverride(
      admin,
      bundle.id,
      marketId,
      parentVariantGid,
    );
    return result;
  }

  return { error: "Unknown intent" };
};

const ROUNDING_RULES = [
  { label: "No rounding", value: "" },
  { label: "Round to .99 (e.g., $27.99)", value: "0.99" },
  { label: "Round to .95 (e.g., $27.95)", value: "0.95" },
  { label: "Round to .00 (whole number)", value: "0.00" },
  { label: "Round to .50 (e.g., $27.50)", value: "0.50" },
];

export default function BundlePricing() {
  const { bundle, markets, existingOverrides, canUseMultiMarket, activePlan } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const shopify = useAppBridge();

  // Build a map of existing overrides by marketId
  const overrideMap = new Map(
    existingOverrides.map((o: any) => [o.marketGid, o]),
  );

  const [editingMarket, setEditingMarket] = useState<string | null>(null);
  const [prices, setPrices] = useState<
    Record<string, { price: string; roundingRule: string }>
  >({});

  const getMarketPrice = (marketId: string) => {
    if (prices[marketId]) return prices[marketId];
    const existing = overrideMap.get(marketId);
    return {
      price: existing ? String(existing.fixedPrice) : "",
      roundingRule: existing?.roundingRule ?? "",
    };
  };

  const setMarketPrice = (
    marketId: string,
    field: "price" | "roundingRule",
    value: string,
  ) => {
    setPrices((prev) => ({
      ...prev,
      [marketId]: {
        ...getMarketPrice(marketId),
        [field]: value,
      },
    }));
  };

  const saveOverride = (market: any) => {
    const { price, roundingRule } = getMarketPrice(market.id);
    const rawPrice = parseFloat(price);
    if (isNaN(rawPrice) || rawPrice <= 0) {
      shopify.toast.show("Enter a valid price", { isError: true });
      return;
    }

    const formData = new FormData();
    formData.set("intent", "set_override");
    formData.set(
      "data",
      JSON.stringify({
        marketId: market.id,
        marketName: market.name,
        currencyCode: market.currencyCode,
        rawPrice,
        roundingRule: roundingRule || null,
      }),
    );
    submit(formData, { method: "POST" });
    setEditingMarket(null);
    shopify.toast.show(`Price set for ${market.name}`);
  };

  const removeOverride = (marketId: string) => {
    const formData = new FormData();
    formData.set("intent", "remove_override");
    formData.set("marketId", marketId);
    submit(formData, { method: "POST" });
  };

  if (!canUseMultiMarket) {
    return (
      <s-page
        heading="Market Pricing"
        backAction={{ url: `/app/bundles/${bundle.id}` }}
      >
        <s-card>
          <s-stack direction="block" gap="base">
            <s-heading>Global plan required</s-heading>
            <s-paragraph>
              Multi-market pricing is available on the Global plan ($29.99/month).
              Set per-currency prices with rounding rules for each of your
              international markets.
            </s-paragraph>
            <s-button href="/app/billing" variant="primary">
              Upgrade to Global
            </s-button>
          </s-stack>
        </s-card>
      </s-page>
    );
  }

  return (
    <s-page
      heading={`Market Pricing — ${bundle.title}`}
      backAction={{ url: `/app/bundles/${bundle.id}` }}
    >
      <s-layout>
        <s-layout-section>
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Base price</s-heading>
              <s-paragraph>
                Bundle base price (primary market):{" "}
                <strong>
                  ${bundle.bundlePrice ? bundle.bundlePrice.toFixed(2) : "N/A"}
                </strong>
              </s-paragraph>
              <s-paragraph>
                Set override prices below for each of your non-primary markets.
                Prices are applied via Shopify PriceLists and served
                automatically at checkout.
              </s-paragraph>
            </s-stack>
          </s-card>

          {markets.length === 0 ? (
            <s-card>
              <s-empty-state heading="No non-primary markets found">
                <s-paragraph>
                  Enable additional markets in your Shopify settings to set
                  per-market prices.
                </s-paragraph>
              </s-empty-state>
            </s-card>
          ) : (
            <s-card>
              <s-stack direction="block" gap="base">
                <s-heading>Markets ({markets.length})</s-heading>
                {markets.map((market: any) => {
                  const existing = overrideMap.get(market.id);
                  const isEditing = editingMarket === market.id;
                  const { price, roundingRule } = getMarketPrice(market.id);

                  const previewPrice = price
                    ? applyRoundingRule(
                        parseFloat(price) || 0,
                        roundingRule || null,
                      )
                    : null;

                  return (
                    <s-box
                      key={market.id}
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                    >
                      <s-stack direction="block" gap="base">
                        <s-stack
                          direction="inline"
                          gap="base"
                          align="space-between"
                        >
                          <s-stack direction="block" gap="extraTight">
                            <s-text fontWeight="semibold">{market.name}</s-text>
                            <s-text variant="bodySm" tone="subdued">
                              {market.currencyCode}
                            </s-text>
                          </s-stack>
                          <s-stack direction="inline" gap="tight">
                            {existing && !isEditing && (
                              <s-text tone="success">
                                {existing.currencyCode}{" "}
                                {existing.fixedPrice.toFixed(2)}
                              </s-text>
                            )}
                            {!isEditing && (
                              <s-button
                                size="slim"
                                onClick={() => setEditingMarket(market.id)}
                              >
                                {existing ? "Edit" : "Set price"}
                              </s-button>
                            )}
                            {!isEditing && existing && (
                              <s-button
                                size="slim"
                                variant="tertiary"
                                tone="critical"
                                onClick={() => removeOverride(market.id)}
                              >
                                Remove
                              </s-button>
                            )}
                          </s-stack>
                        </s-stack>

                        {isEditing && (
                          <s-stack direction="block" gap="base">
                            <s-stack direction="inline" gap="base">
                              <s-text-field
                                label={`Price (${market.currencyCode})`}
                                type="number"
                                value={price}
                                onChange={(e: any) =>
                                  setMarketPrice(
                                    market.id,
                                    "price",
                                    e.target.value,
                                  )
                                }
                                min="0"
                                step="0.01"
                                autoComplete="off"
                              />
                              <s-select
                                label="Rounding rule"
                                value={roundingRule}
                                onChange={(e: any) =>
                                  setMarketPrice(
                                    market.id,
                                    "roundingRule",
                                    e.target.value,
                                  )
                                }
                                options={ROUNDING_RULES}
                              />
                            </s-stack>
                            {previewPrice !== null && (
                              <s-text tone="subdued">
                                Preview: {market.currencyCode}{" "}
                                {previewPrice.toFixed(2)}
                              </s-text>
                            )}
                            <s-stack direction="inline" gap="tight">
                              <s-button
                                variant="primary"
                                onClick={() => saveOverride(market)}
                              >
                                Save price
                              </s-button>
                              <s-button
                                variant="tertiary"
                                onClick={() => setEditingMarket(null)}
                              >
                                Cancel
                              </s-button>
                            </s-stack>
                          </s-stack>
                        )}
                      </s-stack>
                    </s-box>
                  );
                })}
              </s-stack>
            </s-card>
          )}
        </s-layout-section>

        <s-layout-section variant="oneThird">
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>How it works</s-heading>
              <s-paragraph>
                Override prices are stored in Shopify PriceLists and applied
                automatically when a customer checks out from a non-primary
                market.
              </s-paragraph>
              <s-paragraph>
                Rounding rules allow you to set psychological prices like $X.99
                or $X.95 regardless of the raw converted price.
              </s-paragraph>
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
