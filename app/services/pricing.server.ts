/**
 * Server-side re-export of pricing utilities.
 *
 * The actual implementations live in ~/utils/pricing.ts (no .server suffix)
 * so they can be safely imported in both server and client code.
 *
 * Existing server-side imports from this file continue to work unchanged.
 */
export {
  calculateProportionalPrices,
  calculateBundlePrice,
  applyRoundingRule,
} from "~/utils/pricing";

export type {
  ComponentPriceInput,
  DistributedPrice,
} from "~/utils/pricing";
