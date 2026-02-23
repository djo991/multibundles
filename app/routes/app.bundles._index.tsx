import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { authenticate } from "~/shopify.server";
import { getOrCreateShop } from "~/models/shop.server";
import { getBundles, getBundleCount } from "~/models/bundle.server";
import { getPlanLimits } from "~/services/plan-gating.server";
import { UpgradeBanner } from "~/components/UpgradeBanner";

const BUNDLE_TYPE_LABELS: Record<string, string> = {
  fixed: "Fixed",
  mix_and_match: "Mix & Match",
  volume: "Volume",
  custom: "Custom",
};

const STATUS_TONES: Record<string, string> = {
  active: "success",
  draft: "attention",
  archived: "info",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const bundleType = url.searchParams.get("type") || undefined;

  const [bundles, bundleCount] = await Promise.all([
    getBundles(shop.id, { status, bundleType }),
    getBundleCount(shop.id),
  ]);

  const limits = getPlanLimits(shop.activePlan);
  const atLimit =
    limits.maxBundles !== Infinity && bundleCount >= limits.maxBundles;

  return {
    bundles,
    shopPlan: shop.activePlan,
    bundleCount,
    maxBundles: limits.maxBundles,
    atLimit,
  };
};

export default function BundleList() {
  const { bundles, shopPlan, bundleCount, maxBundles, atLimit } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const currentStatus = searchParams.get("status") || "all";
  const currentType = searchParams.get("type") || "all";

  function handleStatusFilter(status: string) {
    const params = new URLSearchParams(searchParams);
    if (status === "all") {
      params.delete("status");
    } else {
      params.set("status", status);
    }
    setSearchParams(params);
  }

  function handleTypeFilter(type: string) {
    const params = new URLSearchParams(searchParams);
    if (type === "all") {
      params.delete("type");
    } else {
      params.set("type", type);
    }
    setSearchParams(params);
  }

  return (
    <s-page
      heading="Bundles"
      backAction={{ url: "/app" }}
    >
      <s-button slot="primary-action" href="/app/bundles/new" variant="primary">
        Create bundle
      </s-button>

      {atLimit && (
        <UpgradeBanner
          feature={`You've reached your ${maxBundles}-bundle limit`}
          requiredPlan="Launch"
          planPrice="$9.99"
          description="Upgrade to the Launch plan for unlimited bundles and more bundle types."
        />
      )}

      <s-card>
        <s-stack direction="block" gap="base">
          {/* Filters */}
          <s-stack direction="inline" gap="tight">
            <s-button
              variant={currentStatus === "all" ? "primary" : "tertiary"}
              onClick={() => handleStatusFilter("all")}
              size="slim"
            >
              All
            </s-button>
            <s-button
              variant={currentStatus === "active" ? "primary" : "tertiary"}
              onClick={() => handleStatusFilter("active")}
              size="slim"
            >
              Active
            </s-button>
            <s-button
              variant={currentStatus === "draft" ? "primary" : "tertiary"}
              onClick={() => handleStatusFilter("draft")}
              size="slim"
            >
              Draft
            </s-button>
            <s-button
              variant={currentStatus === "archived" ? "primary" : "tertiary"}
              onClick={() => handleStatusFilter("archived")}
              size="slim"
            >
              Archived
            </s-button>
          </s-stack>

          {bundles.length === 0 ? (
            <s-empty-state
              heading="No bundles yet"
              action={{ content: "Create bundle", url: "/app/bundles/new" }}
            >
              <s-paragraph>
                Create your first bundle to start increasing your average order
                value.
              </s-paragraph>
            </s-empty-state>
          ) : (
            <s-resource-list>
              {bundles.map((bundle) => (
                <s-resource-item
                  key={bundle.id}
                  onClick={() => navigate(`/app/bundles/${bundle.id}`)}
                >
                  <s-stack direction="inline" gap="base" align="center">
                    {bundle.productImageUrl && (
                      <s-thumbnail
                        source={bundle.productImageUrl}
                        alt={bundle.title}
                        size="small"
                      />
                    )}
                    <s-stack direction="block" gap="extraTight">
                      <s-text variant="bodyMd" fontWeight="semibold">
                        {bundle.title}
                      </s-text>
                      <s-stack direction="inline" gap="tight">
                        <s-badge tone={STATUS_TONES[bundle.status] || "info"}>
                          {bundle.status}
                        </s-badge>
                        <s-badge>
                          {BUNDLE_TYPE_LABELS[bundle.bundleType] ||
                            bundle.bundleType}
                        </s-badge>
                        <s-text variant="bodySm" tone="subdued">
                          {bundle.components.length} component
                          {bundle.components.length !== 1 ? "s" : ""}
                        </s-text>
                      </s-stack>
                    </s-stack>
                  </s-stack>
                </s-resource-item>
              ))}
            </s-resource-list>
          )}
        </s-stack>
      </s-card>
    </s-page>
  );
}
