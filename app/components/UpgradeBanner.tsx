/**
 * UpgradeBanner
 *
 * Displays a contextual upgrade prompt when a feature is plan-gated.
 * Used throughout the admin UI to surface plan limits inline.
 */

interface UpgradeBannerProps {
  /** Human-readable name of the gated feature */
  feature: string;
  /** The plan name required to unlock it (e.g., "Launch", "Global") */
  requiredPlan: string;
  /** The monthly price of the required plan */
  planPrice?: string;
  /** Optional extra description */
  description?: string;
}

export function UpgradeBanner({
  feature,
  requiredPlan,
  planPrice,
  description,
}: UpgradeBannerProps) {
  return (
    <s-banner tone="info">
      <s-stack direction="block" gap="tight">
        <s-text fontWeight="semibold">
          {feature} requires the {requiredPlan} plan
          {planPrice ? ` (${planPrice}/month)` : ""}
        </s-text>
        {description && <s-text>{description}</s-text>}
        <s-button href="/app/billing" size="slim" variant="primary">
          Upgrade to {requiredPlan}
        </s-button>
      </s-stack>
    </s-banner>
  );
}

/**
 * PlanBadge
 *
 * Small badge indicating which plan a feature requires.
 */
interface PlanBadgeProps {
  plan: "launch" | "global";
}

export function PlanBadge({ plan }: PlanBadgeProps) {
  const tone = plan === "global" ? "success" : "info";
  const label = plan === "global" ? "Global" : "Launch";
  return <s-badge tone={tone}>{label}+</s-badge>;
}
