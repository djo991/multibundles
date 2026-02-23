import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "~/models/shop.server";
import { getBundles, getBundleCount } from "~/models/bundle.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const bundleCount = await getBundleCount(shop.id);
  const recentBundles = await getBundles(shop.id);

  return {
    shop: { domain: shop.shopDomain, plan: shop.activePlan },
    bundleCount,
    recentBundles: recentBundles.slice(0, 5),
  };
};

export default function Dashboard() {
  const { shop, bundleCount, recentBundles } = useLoaderData<typeof loader>();

  const planLabel =
    shop.plan === "free"
      ? "Free"
      : shop.plan.charAt(0).toUpperCase() + shop.plan.slice(1);

  return (
    <s-page heading="MultiBundles">
      <s-button slot="primary-action" href="/app/bundles/new">
        Create bundle
      </s-button>

      <s-layout>
        <s-layout-section>
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Welcome to MultiBundles</s-heading>
              <s-paragraph>
                Create powerful product bundles that work seamlessly with
                Shopify's checkout. Your bundles expand into real line items for
                accurate financials and inventory tracking.
              </s-paragraph>
            </s-stack>
          </s-card>

          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Quick stats</s-heading>
              <s-stack direction="inline" gap="loose">
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="tight">
                    <s-text variant="headingLg">{bundleCount}</s-text>
                    <s-text variant="bodySm" tone="subdued">
                      Total bundles
                    </s-text>
                  </s-stack>
                </s-box>
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="tight">
                    <s-text variant="headingLg">{planLabel}</s-text>
                    <s-text variant="bodySm" tone="subdued">
                      Current plan
                    </s-text>
                  </s-stack>
                </s-box>
              </s-stack>
            </s-stack>
          </s-card>

          {recentBundles.length > 0 && (
            <s-card>
              <s-stack direction="block" gap="base">
                <s-heading>Recent bundles</s-heading>
                {recentBundles.map((bundle) => (
                  <s-link key={bundle.id} href={`/app/bundles/${bundle.id}`}>
                    <s-stack direction="inline" gap="base">
                      <s-text>{bundle.title}</s-text>
                      <s-badge
                        tone={
                          bundle.status === "active" ? "success" : "attention"
                        }
                      >
                        {bundle.status}
                      </s-badge>
                      <s-badge>{bundle.bundleType.replace(/_/g, " ")}</s-badge>
                    </s-stack>
                  </s-link>
                ))}
              </s-stack>
            </s-card>
          )}
        </s-layout-section>

        <s-layout-section variant="oneThird">
          <s-card>
            <s-stack direction="block" gap="base">
              <s-heading>Bundle types</s-heading>
              <s-unordered-list>
                <s-list-item>
                  <strong>Fixed</strong> - Pre-defined product sets
                </s-list-item>
                <s-list-item>
                  <strong>Mix &amp; Match</strong> - Customer picks from a pool
                </s-list-item>
                <s-list-item>
                  <strong>Volume</strong> - Buy more, save more
                </s-list-item>
                <s-list-item>
                  <strong>Custom</strong> - Fixed + customer choice
                </s-list-item>
              </s-unordered-list>
              <s-button href="/app/bundles/new" variant="primary">
                Create your first bundle
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
