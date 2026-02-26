import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // TODO: Phase 5 - Inventory sync on order creation
  // 1. Identify bundle products in order line items
  // 2. For each bundle, recalculate availability
  // 3. Update parent product inventory

  return new Response();
};
