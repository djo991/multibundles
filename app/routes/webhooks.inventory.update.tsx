import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // TODO: Phase 5 - Inventory sync on level changes
  // 1. Identify which bundles contain the updated variant
  // 2. Recalculate bundle availability
  // 3. Update parent product inventory

  return new Response();
};
