import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { authenticate } from "~/shopify.server";
import { getOrCreateShop } from "~/models/shop.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";
import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  return {
    shopDomain: shop.shopDomain,
    activePlan: shop.activePlan,
    bundleCount: await import("~/models/bundle.server").then((m) =>
      m.getBundleCount(shop.id),
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  // Settings actions (future: save preferences)
  return { success: true };
};

export default function Settings() {
  const { shopDomain, activePlan, bundleCount } =
    useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  const planLabel =
    activePlan === "free"
      ? "Free"
      : activePlan.charAt(0).toUpperCase() + activePlan.slice(1);

  const planTone =
    activePlan === "global"
      ? "success"
      : activePlan === "launch"
        ? "info"
        : "new";

  return (
    <s-page heading="Settings" backAction={{ url: "/app" }}>
      <s-layout>
        <s-layout-section>
          {/* Account Overview */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Account overview</s-heading>
              <s-stack direction="inline" gap="base" align="center">
                <s-text tone="subdued">Store:</s-text>
                <s-text fontWeight="semibold">{shopDomain}</s-text>
              </s-stack>
              <s-stack direction="inline" gap="base" align="center">
                <s-text tone="subdued">Current plan:</s-text>
                <s-badge tone={planTone}>{planLabel}</s-badge>
              </s-stack>
              <s-stack direction="inline" gap="base" align="center">
                <s-text tone="subdued">Total bundles:</s-text>
                <s-text fontWeight="semibold">{bundleCount}</s-text>
              </s-stack>
              {activePlan !== "global" && (
                <s-button href="/app/billing" variant="primary">
                  Upgrade plan
                </s-button>
              )}
            </s-stack>
          </s-card>

          {/* Plan features */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Plan features</s-heading>

              <s-stack direction="block" gap="tight">
                {/* Free */}
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background={activePlan === "free" ? "subdued" : undefined}
                >
                  <s-stack direction="block" gap="tight">
                    <s-stack direction="inline" align="space-between">
                      <s-text fontWeight="semibold">Free</s-text>
                      <s-text tone="subdued">$0 / month</s-text>
                    </s-stack>
                    <s-text variant="bodySm" tone="subdued">
                      3 bundles · Fixed type only · No cart upsell · No
                      multi-market pricing
                    </s-text>
                  </s-stack>
                </s-box>

                {/* Launch */}
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background={activePlan === "launch" ? "subdued" : undefined}
                >
                  <s-stack direction="block" gap="tight">
                    <s-stack direction="inline" align="space-between">
                      <s-text fontWeight="semibold">Launch</s-text>
                      <s-text tone="subdued">$9.99 / month</s-text>
                    </s-stack>
                    <s-text variant="bodySm" tone="subdued">
                      Unlimited bundles · Fixed + Mix & Match + Volume ·
                      Cart upsell · 7-day free trial
                    </s-text>
                  </s-stack>
                </s-box>

                {/* Global */}
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background={activePlan === "global" ? "subdued" : undefined}
                >
                  <s-stack direction="block" gap="tight">
                    <s-stack direction="inline" align="space-between">
                      <s-text fontWeight="semibold">Global</s-text>
                      <s-text tone="subdued">$29.99 / month</s-text>
                    </s-stack>
                    <s-text variant="bodySm" tone="subdued">
                      Everything in Launch · Custom bundles · Multi-market
                      pricing · Full analytics · 7-day free trial
                    </s-text>
                  </s-stack>
                </s-box>
              </s-stack>
            </s-stack>
          </s-card>

          {/* Metafield namespace info */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Technical configuration</s-heading>
              <s-paragraph>
                MultiBundles stores bundle configuration in Shopify product
                metafields. These are read by the Shopify Functions (Cart
                Transform and Discount Function) at checkout.
              </s-paragraph>
              <s-stack direction="block" gap="tight">
                <s-stack direction="inline" gap="base">
                  <s-text tone="subdued">Metafield namespace:</s-text>
                  <s-text fontWeight="semibold">$app:multibundles</s-text>
                </s-stack>
                <s-stack direction="inline" gap="base">
                  <s-text tone="subdued">Bundle config key:</s-text>
                  <s-text fontWeight="semibold">bundle-config</s-text>
                </s-stack>
                <s-stack direction="inline" gap="base">
                  <s-text tone="subdued">Volume config key:</s-text>
                  <s-text fontWeight="semibold">volume-config</s-text>
                </s-stack>
              </s-stack>
            </s-stack>
          </s-card>
        </s-layout-section>

        <s-layout-section variant="oneThird">
          {/* Quick links */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Quick links</s-heading>
              <s-stack direction="block" gap="tight">
                <s-link href="/app/bundles">Manage bundles</s-link>
                <s-link href="/app/billing">Billing & plan</s-link>
                <s-link
                  href="https://shopify.dev/docs/apps/tools/app-bridge"
                  target="_blank"
                >
                  App Bridge docs
                </s-link>
                <s-link
                  href="https://shopify.dev/docs/api/functions/reference/cart-transform"
                  target="_blank"
                >
                  Cart Transform docs
                </s-link>
              </s-stack>
            </s-stack>
          </s-card>

          {/* Support */}
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Support</s-heading>
              <s-paragraph>
                Need help? Check our documentation or reach out to support.
              </s-paragraph>
              <s-button
                href="mailto:support@multibundles.app"
                target="_blank"
                variant="tertiary"
              >
                Contact support
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
