/**
 * Proportional Price Distribution Algorithm
 *
 * Distributes a bundle's total price across its components proportionally
 * based on each component's original price relative to the total original price.
 *
 * Example: Bundle price = $30, components at $20 + $15 + $10 = $45 original
 *   Component A: ($20/$45) * $30 = $13.33
 *   Component B: ($15/$45) * $30 = $10.00
 *   Component C: ($10/$45) * $30 = $6.67
 *   Sum = $30.00 (exact, remainder adjustment on last item)
 *
 * This module contains ONLY pure math functions with no server dependencies,
 * so it can safely be imported in both server and client code.
 */

export interface ComponentPriceInput {
  variantGid: string;
  originalPrice: number;
  quantity: number;
}

export interface DistributedPrice {
  variantGid: string;
  pricePerUnit: number;
}

export function calculateProportionalPrices(
  bundleTotalPrice: number,
  components: ComponentPriceInput[],
): DistributedPrice[] {
  if (components.length === 0) return [];

  const totalOriginal = components.reduce(
    (sum, c) => sum + c.originalPrice * c.quantity,
    0,
  );

  // If all originals are 0, distribute evenly
  if (totalOriginal === 0) {
    const totalUnits = components.reduce((sum, c) => sum + c.quantity, 0);
    const evenPrice = Math.floor((bundleTotalPrice / totalUnits) * 100) / 100;
    let remaining = Math.round(bundleTotalPrice * 100);

    return components.map((component, index) => {
      const isLast = index === components.length - 1;
      if (isLast) {
        const lastPrice = remaining / 100 / component.quantity;
        return {
          variantGid: component.variantGid,
          pricePerUnit: Math.round(lastPrice * 100) / 100,
        };
      }
      const unitPrice = evenPrice;
      remaining -= Math.round(unitPrice * component.quantity * 100);
      return {
        variantGid: component.variantGid,
        pricePerUnit: unitPrice,
      };
    });
  }

  // Proportional distribution with penny-perfect remainder handling
  let distributedCents = 0;
  const totalCents = Math.round(bundleTotalPrice * 100);

  return components.map((component, index) => {
    const isLast = index === components.length - 1;
    const weight =
      (component.originalPrice * component.quantity) / totalOriginal;

    let componentTotalCents: number;
    if (isLast) {
      componentTotalCents = totalCents - distributedCents;
    } else {
      componentTotalCents = Math.round(weight * totalCents);
      distributedCents += componentTotalCents;
    }

    const pricePerUnit = componentTotalCents / component.quantity / 100;

    return {
      variantGid: component.variantGid,
      pricePerUnit: Math.round(pricePerUnit * 100) / 100,
    };
  });
}

/**
 * Calculate the effective bundle price based on discount configuration.
 */
export function calculateBundlePrice(
  components: Array<{ originalPrice: number; quantity: number }>,
  discountType: string,
  discountValue: number,
  manualBundlePrice?: number | null,
): number {
  if (discountType === "manual_price" && manualBundlePrice != null) {
    return manualBundlePrice;
  }

  const totalOriginal = components.reduce(
    (sum, c) => sum + c.originalPrice * c.quantity,
    0,
  );

  switch (discountType) {
    case "percentage":
      return Math.round(totalOriginal * (1 - discountValue / 100) * 100) / 100;
    case "fixed_amount":
      return Math.max(0, Math.round((totalOriginal - discountValue) * 100) / 100);
    default:
      return totalOriginal;
  }
}

/**
 * Apply a rounding rule to a price for psychological pricing.
 * e.g., applyRoundingRule(27.43, "0.99") -> 27.99
 */
export function applyRoundingRule(
  price: number,
  roundingRule: string | null | undefined,
): number {
  if (!roundingRule) return price;
  const wholePart = Math.floor(price);
  const fraction = parseFloat(roundingRule);
  if (isNaN(fraction)) return price;
  return wholePart + fraction;
}
