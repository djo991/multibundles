/**
 * Webhook: APP_SUBSCRIPTIONS_UPDATE
 *
 * Fires when a merchant's subscription status changes — activated, cancelled,
 * declined, expired, or frozen. Keeps the shop's `activePlan` in the database
 * in sync with the actual Shopify billing state.
 *
 * Topic: app_subscriptions/update
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { updateShopPlan } from "~/models/shop.server";
import { PLANS } from "~/shopify.server";

/**
 * Map Shopify plan names (from billing config) to our internal plan slugs.
 */
function resolvePlanSlug(planName: string | null | undefined): string {
  if (!planName) return "free";
  if (planName === PLANS.GLOBAL) return "global";
  if (planName === PLANS.LAUNCH) return "launch";
  return "free";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const subscription = payload as {
    app_subscription?: {
      name?: string;
      status?: string;
      admin_graphql_api_id?: string;
    };
  };

  const sub = subscription.app_subscription;
  if (!sub) {
    console.warn("APP_SUBSCRIPTIONS_UPDATE: no app_subscription in payload");
    return new Response();
  }

  const status = sub.status?.toUpperCase();
  const planName = sub.name ?? null;
  const subscriptionGid = sub.admin_graphql_api_id ?? null;

  // ACTIVE → set to the corresponding plan
  // CANCELLED, DECLINED, EXPIRED, FROZEN → revert to free
  if (status === "ACTIVE") {
    const planSlug = resolvePlanSlug(planName);
    await updateShopPlan(shop, planSlug, subscriptionGid ?? undefined);
    console.log(
      `Shop ${shop} plan updated to "${planSlug}" (${planName}) — subscription: ${subscriptionGid}`,
    );
  } else {
    await updateShopPlan(shop, "free", undefined);
    console.log(
      `Shop ${shop} plan reverted to "free" — subscription status: ${status}`,
    );
  }

  return new Response();
};
