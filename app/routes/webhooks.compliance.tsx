import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received compliance webhook ${topic} for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // Return customer data on request
      // MultiBundles does not store customer PII beyond Shopify sessions
      break;
    case "CUSTOMERS_REDACT":
      // Delete customer data on request
      break;
    case "SHOP_REDACT":
      // Delete all shop data on uninstall (48h after app/uninstalled)
      // TODO: Delete Shop, Bundle, and all related records for this shop
      break;
  }

  return new Response();
};
