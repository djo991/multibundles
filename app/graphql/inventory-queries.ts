export const GET_INVENTORY_LEVELS = `#graphql
  query GetInventoryLevels($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        inventoryQuantity
        inventoryItem {
          id
          inventoryLevels(first: 10) {
            edges {
              node {
                id
                quantities(names: ["available"]) {
                  name
                  quantity
                }
                location {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const INVENTORY_SET_QUANTITIES = `#graphql
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        createdAt
        reason
      }
      userErrors {
        field
        message
      }
    }
  }
`;
