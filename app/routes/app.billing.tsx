import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { authenticate, PLANS } from "~/shopify.server";
import { getOrCreateShop, updateShopPlan } from "~/models/shop.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  // Check current billing status against Shopify (source of truth)
  let currentPlan: string | null = null;
  let subscriptionGid: string | null = null;
  try {
    const billingCheck = await billing.check({
      plans: [PLANS.LAUNCH, PLANS.GLOBAL],
      isTest: process.env.NODE_ENV !== "production",
    });
    if (billingCheck.hasActivePayment) {
      const sub = billingCheck.appSubscriptions?.[0];
      currentPlan = sub?.name ?? null;
      subscriptionGid = (sub as any)?.id ?? null;
    }
  } catch {
    // No active billing - free plan
  }

  // Sync DB plan if it drifted from Shopify billing state
  // (e.g. merchant just returned from billing approval page)
  const billingPlanSlug = !currentPlan
    ? "free"
    : currentPlan === PLANS.GLOBAL
      ? "global"
      : "launch";

  if (billingPlanSlug !== shop.activePlan) {
    await updateShopPlan(
      session.shop,
      billingPlanSlug,
      subscriptionGid ?? undefined,
    );
  }

  return {
    activePlan: billingPlanSlug,
    currentBillingPlan: currentPlan,
    shopDomain: session.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planName = formData.get("plan") as string;

  if (planName !== PLANS.LAUNCH && planName !== PLANS.GLOBAL) {
    return { error: "Invalid plan" };
  }

  // billing.request() redirects merchant to Shopify approval page.
  // Plan update in DB is handled by APP_SUBSCRIPTIONS_UPDATE webhook
  // + the loader sync above when they return to this page.
  await billing.request({
    plan: planName,
    isTest: process.env.NODE_ENV !== "production",
    returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing?shop=${session.shop}`,
  });

  // billing.request() always redirects - this line is unreachable
  return { success: true };
};

export default function Billing() {
  const { activePlan, currentBillingPlan } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const [subscribing, setSubscribing] = useState<string | null>(null);

  const subscribe = (plan: string) => {
    setSubscribing(plan);
    const formData = new FormData();
    formData.set("plan", plan);
    submit(formData, { method: "POST" });
  };

  const isOnLaunch = activePlan === "launch";
  const isOnGlobal = activePlan === "global";

  return (
    <s-page heading="Billing & Plans" backAction={{ url: "/app" }}>
      <s-layout>
        <s-layout-section>
          {/* Current plan banner */}
          {activePlan !== "free" && (
            <s-banner tone="success">
              <s-paragraph>
                You're on the{" "}
                <strong>
                  {activePlan.charAt(0).toUpperCase() + activePlan.slice(1)}
                </strong>{" "}
                plan. Thank you!
              </s-paragraph>
            </s-banner>
          )}

          {/* Plan cards */}
          <s-stack direction="inline" gap="base" align="start">
            {/* Free plan */}
            <s-card>
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" align="space-between">
                  <s-heading>Free</s-heading>
                  {activePlan === "free" && (
                    <s-badge tone="success">Current</s-badge>
                  )}
                </s-stack>
                <s-text variant="heading2xl" fontWeight="bold">
                  $0
                </s-text>
                <s-text tone="subdued">per month, forever</s-text>

                <s-divider />

                <s-stack direction="block" gap="tight">
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="checkmark" />
                    <s-text>Up to 3 bundles</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="checkmark" />
                    <s-text>Fixed bundles only</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="minus" />
                    <s-text tone="subdued">No Mix & Match</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="minus" />
                    <s-text tone="subdued">No Volume discounts</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="minus" />
                    <s-text tone="subdued">No Custom bundles</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="minus" />
                    <s-text tone="subdued">No cart upsell</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="minus" />
                    <s-text tone="subdued">No multi-market pricing</s-text>
                  </s-stack>
                </s-stack>
              </s-stack>
            </s-card>

            {/* Launch plan */}
            <s-card>
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" align="space-between">
                  <s-heading>Launch</s-heading>
                  {isOnLaunch && <s-badge tone="success">Current</s-badge>}
                  {!isOnLaunch && !isOnGlobal && (
                    <s-badge tone="info">Popular</s-badge>
                  )}
                </s-stack>
                <s-text variant="heading2xl" fontWeight="bold">
                  $9.99
                </s-text>
                <s-text tone="subdued">per month · 7-day free trial</s-text>

                <s-divider />

                <s-stack direction="block" gap="tight">
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="checkmark" />
                    <s-text>
                      <strong>Unlimited</strong> bundles
                    </s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="checkmark" />
                    <s-text>Fixed bundles</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="checkmark" />
                    <s-text>Mix & Match bundles</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="checkmark" />
                    <s-text>Volume / Tiered bundles</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="checkmark" />
                    <s-text>Cart drawer upsell</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="minus" />
                    <s-text tone="subdued">No Custom bundles</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="minus" />
                    <s-text tone="subdued">No multi-market pricing</s-text>
                  </s-stack>
                </s-stack>

                {!isOnLaunch && !isOnGlobal && (
                  <s-button
                    variant="primary"
                    onClick={() => subscribe(PLANS.LAUNCH)}
                    {...(subscribing === PLANS.LAUNCH ? { loading: true } : {})}
                  >
                    Start free trial
                  </s-button>
                )}
                {isOnLaunch && (
                  <s-button
                    onClick={() => subscribe(PLANS.GLOBAL)}
                    {...(subscribing === PLANS.GLOBAL ? { loading: true } : {})}
                  >
                    Upgrade to Global
                  </s-button>
                )}
              </s-stack>
            </s-card>

            {/* Global plan */}
            <s-card>
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" align="space-between">
                  <s-heading>Global</s-heading>
                  {isOnGlobal && <s-badge tone="success">Current</s-badge>}
                </s-stack>
                <s-text variant="heading2xl" fontWeight="bold">
                  $29.99
                </s-text>
                <s-text tone="subdued">per month · 7-day free trial</s-text>

                <s-divider />

                <s-stack direction="block" gap="tight">
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="checkmark" />
                    <s-text>Everything in Launch</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="checkmark" />
                    <s-text>
                      <strong>Custom bundles</strong> (fixed + customer picks)
                    </s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="checkmark" />
                    <s-text>
                      <strong>Multi-market pricing</strong> with rounding rules
                    </s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="checkmark" />
                    <s-text>Priority support</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-icon source="checkmark" />
                    <s-text>Advanced analytics (coming soon)</s-text>
                  </s-stack>
                </s-stack>

                {!isOnGlobal && (
                  <s-button
                    variant="primary"
                    onClick={() => subscribe(PLANS.GLOBAL)}
                    {...(subscribing === PLANS.GLOBAL ? { loading: true } : {})}
                  >
                    {activePlan === "free"
                      ? "Start free trial"
                      : "Upgrade to Global"}
                  </s-button>
                )}
              </s-stack>
            </s-card>
          </s-stack>

          {/* FAQ */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Frequently asked questions</s-heading>

              <s-stack direction="block" gap="base">
                <s-stack direction="block" gap="tight">
                  <s-text fontWeight="semibold">
                    Can I cancel my subscription anytime?
                  </s-text>
                  <s-text tone="subdued">
                    Yes. You can cancel your subscription at any time from the
                    Shopify admin. Your bundles remain accessible until the end
                    of the billing period.
                  </s-text>
                </s-stack>

                <s-stack direction="block" gap="tight">
                  <s-text fontWeight="semibold">
                    What happens to my bundles if I downgrade?
                  </s-text>
                  <s-text tone="subdued">
                    Bundles of types no longer available on your plan will be
                    automatically deactivated. You can still view and edit them,
                    but they won't process at checkout.
                  </s-text>
                </s-stack>

                <s-stack direction="block" gap="tight">
                  <s-text fontWeight="semibold">
                    Is there a revenue share or transaction fee?
                  </s-text>
                  <s-text tone="subdued">
                    No. MultiBundles uses flat-fee pricing — we never take a
                    percentage of your sales, regardless of your plan.
                  </s-text>
                </s-stack>

                <s-stack direction="block" gap="tight">
                  <s-text fontWeight="semibold">
                    How does the free trial work?
                  </s-text>
                  <s-text tone="subdued">
                    Both paid plans include a 7-day free trial. You won't be
                    charged until the trial period ends, and you can cancel
                    before then for no charge.
                  </s-text>
                </s-stack>
              </s-stack>
            </s-stack>
          </s-card>
        </s-layout-section>

        <s-layout-section variant="oneThird">
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Your current plan</s-heading>
              <s-badge
                tone={
                  activePlan === "global"
                    ? "success"
                    : activePlan === "launch"
                      ? "info"
                      : "new"
                }
              >
                {activePlan.charAt(0).toUpperCase() + activePlan.slice(1)}
              </s-badge>
              <s-paragraph>
                {activePlan === "free" &&
                  "Upgrade to unlock more bundle types and features."}
                {activePlan === "launch" &&
                  "Upgrade to Global to unlock custom bundles and multi-market pricing."}
                {activePlan === "global" &&
                  "You have access to all MultiBundles features."}
              </s-paragraph>
            </s-stack>
          </s-card>

          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Need help choosing?</s-heading>
              <s-paragraph>
                Not sure which plan is right for you? Start with Launch — it
                covers most use cases at a low price. Upgrade to Global if you
                sell internationally or need custom bundles.
              </s-paragraph>
              <s-link href="mailto:support@multibundles.app">
                Talk to us
              </s-link>
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
