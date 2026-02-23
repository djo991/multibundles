export const GET_PRODUCT = `#graphql
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      featuredMedia {
        preview {
          image {
            url
          }
        }
      }
      variants(first: 100) {
        edges {
          node {
            id
            title
            price
            sku
            inventoryQuantity
            image {
              url
            }
          }
        }
      }
    }
  }
`;

export const GET_VARIANT = `#graphql
  query GetVariant($id: ID!) {
    productVariant(id: $id) {
      id
      title
      price
      sku
      inventoryQuantity
      product {
        id
        title
        handle
      }
      image {
        url
      }
    }
  }
`;

export const GET_VARIANTS_BY_IDS = `#graphql
  query GetVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        price
        sku
        inventoryQuantity
        product {
          id
          title
        }
        image {
          url
        }
      }
    }
  }
`;
