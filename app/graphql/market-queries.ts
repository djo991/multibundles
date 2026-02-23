export const GET_MARKETS = `#graphql
  query GetMarkets {
    markets(first: 50) {
      nodes {
        id
        name
        enabled
        primary
        currencySettings {
          baseCurrency {
            currencyCode
            currencyName
          }
        }
      }
    }
  }
`;

export const GET_PRICE_LISTS = `#graphql
  query GetPriceLists {
    priceLists(first: 50) {
      nodes {
        id
        name
        currency
        catalog {
          ... on MarketCatalog {
            id
            markets(first: 10) {
              nodes {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

export const PRICE_LIST_FIXED_PRICES_UPDATE = `#graphql
  mutation PriceListFixedPricesUpdate(
    $priceListId: ID!
    $pricesToAdd: [PriceListPriceInput!]!
    $variantIdsToDelete: [ID!]!
  ) {
    priceListFixedPricesUpdate(
      priceListId: $priceListId
      pricesToAdd: $pricesToAdd
      variantIdsToDelete: $variantIdsToDelete
    ) {
      priceList {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;
