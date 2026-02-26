export type PlanName = "free" | "launch" | "global";

export type BundleType = "fixed" | "mix_and_match" | "volume" | "custom";

interface PlanLimits {
  maxBundles: number;
  allowedBundleTypes: BundleType[];
  multiMarket: boolean;
  cartUpsell: boolean;
}

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
  free: {
    maxBundles: 3,
    allowedBundleTypes: ["fixed"],
    multiMarket: false,
    cartUpsell: false,
  },
  launch: {
    maxBundles: Infinity,
    allowedBundleTypes: ["fixed", "mix_and_match", "volume"],
    multiMarket: false,
    cartUpsell: true,
  },
  global: {
    maxBundles: Infinity,
    allowedBundleTypes: ["fixed", "mix_and_match", "volume", "custom"],
    multiMarket: true,
    cartUpsell: true,
  },
};

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan as PlanName] ?? PLAN_LIMITS.free;
}

export function canCreateBundle(
  plan: string,
  bundleType: BundleType,
  currentCount: number,
): { allowed: boolean; reason?: string } {
  const limits = getPlanLimits(plan);

  if (currentCount >= limits.maxBundles) {
    return {
      allowed: false,
      reason: `Your ${plan} plan allows up to ${limits.maxBundles} bundles. Upgrade to create more.`,
    };
  }

  if (!limits.allowedBundleTypes.includes(bundleType)) {
    return {
      allowed: false,
      reason: `${bundleType.replace("_", " ")} bundles require a higher plan.`,
    };
  }

  return { allowed: true };
}

export function canAccessFeature(
  plan: string,
  feature: "multiMarket" | "cartUpsell",
): boolean {
  const limits = getPlanLimits(plan);
  return limits[feature];
}

export function getRequiredPlanForBundleType(bundleType: BundleType): PlanName {
  if (bundleType === "custom") return "global";
  if (bundleType === "mix_and_match" || bundleType === "volume") return "launch";
  return "free";
}
