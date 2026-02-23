import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "~/shopify.server";
import { getOrCreateShop } from "~/models/shop.server";
import { getPlanLimits, getRequiredPlanForBundleType } from "~/services/plan-gating.server";
import type { BundleType } from "~/services/plan-gating.server";

const BUNDLE_TYPES: Array<{
  type: BundleType;
  title: string;
  description: string;
  examples: string;
}> = [
  {
    type: "fixed",
    title: "Fixed Bundle",
    description:
      "Pre-define exact products and quantities. Customers buy the bundle as-is. Great for starter kits and routine sets.",
    examples: 'e.g. "Skincare Starter Kit", "Coffee Routine Set"',
  },
  {
    type: "mix_and_match",
    title: "Mix & Match",
    description:
      "Let customers pick N items from a curated pool. You define the eligible products and pricing.",
    examples: 'e.g. "Pick Any 3 Snacks", "Build Your Own 6-Pack"',
  },
  {
    type: "volume",
    title: "Volume / Tiered",
    description:
      "Buy more of the same product, save more. Set quantity thresholds with increasing discounts.",
    examples: 'e.g. "Buy 2 for 10% off, Buy 5+ for 25% off"',
  },
  {
    type: "custom",
    title: "Custom Bundle",
    description:
      "Combine fixed components with customer-selected items. Some items are always included, others are chosen from a pool.",
    examples: 'e.g. "Phone Case + Pick 2 Accessories"',
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const limits = getPlanLimits(shop.activePlan);

  return {
    plan: shop.activePlan,
    allowedTypes: limits.allowedBundleTypes,
  };
};

export default function NewBundleSelector() {
  const { plan, allowedTypes } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Create a bundle" backAction={{ url: "/app/bundles" }}>
      <s-layout>
        <s-layout-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Choose the type of bundle you want to create.
            </s-paragraph>

            {BUNDLE_TYPES.map(({ type, title, description, examples }) => {
              const isAllowed = allowedTypes.includes(type);
              const requiredPlan = getRequiredPlanForBundleType(type);

              return (
                <s-card key={type}>
                  <s-stack direction="block" gap="tight">
                    <s-stack direction="inline" gap="base" align="center">
                      <s-text variant="headingMd">{title}</s-text>
                      {!isAllowed && (
                        <s-badge tone="info">
                          Requires {requiredPlan} plan
                        </s-badge>
                      )}
                    </s-stack>
                    <s-paragraph>{description}</s-paragraph>
                    <s-text variant="bodySm" tone="subdued">
                      {examples}
                    </s-text>
                    <s-stack direction="inline" gap="tight">
                      {isAllowed ? (
                        <s-button
                          href={`/app/bundles/new/${type.replace(/_/g, "-")}`}
                          variant="primary"
                        >
                          Create {title.toLowerCase()}
                        </s-button>
                      ) : (
                        <s-button href="/app/billing" variant="secondary">
                          Upgrade to {requiredPlan}
                        </s-button>
                      )}
                    </s-stack>
                  </s-stack>
                </s-card>
              );
            })}
          </s-stack>
        </s-layout-section>
      </s-layout>
    </s-page>
  );
}
