import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { syncInventoryForVariant } from "~/services/inventory.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} for shop ${shop}`);

  try {
    const inventoryItemId = (payload as any)?.inventory_item_id;
    if (!inventoryItemId) {
      return new Response("Missing inventory_item_id", { status: 400 });
    }

    // Resolve the variant GID from the numeric inventory item ID
    const variantResponse = await admin.graphql(
      `#graphql
      query GetVariantFromInventoryItem($id: ID!) {
        inventoryItem(id: $id) {
          variant {
            id
          }
        }
      }`,
      {
        variables: {
          id: \`gid://shopify/InventoryItem/\${inventoryItemId}\`,
        },
      },
    );

    const variantJson = await variantResponse.json();
    const variantGid = variantJson.data?.inventoryItem?.variant?.id;

    if (!variantGid) {
      console.log(\`No variant found for inventory item \${inventoryItemId}\`);
      return new Response();
    }

    // Recalculate and update availability for all bundles that use this variant
    await syncInventoryForVariant(admin, variantGid);
  } catch (e) {
    console.error("Error processing inventory_levels/update webhook:", e);
  }

  return new Response();
};
