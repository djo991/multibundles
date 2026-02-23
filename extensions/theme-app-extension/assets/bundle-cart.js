/**
 * MultiBundles - Cart Drawer Upsell JS
 * ---------------------------------------
 * Injects bundle upsell suggestions into the cart drawer.
 * This script runs in the page context as an App Embed Block.
 *
 * Strategy:
 * 1. Listen for cart drawer open events (covers most themes)
 * 2. Fetch current cart contents
 * 3. Check if any cart items match bundle component variants
 *    (uses the Shopify product JSON to check bundle metafields)
 * 4. Show upsell panel with bundle suggestions
 */

(function () {
  "use strict";

  const ROOT_ID = "multibundles-cart-upsell-root";
  const DEBOUNCE_MS = 300;

  let debounceTimer = null;

  // Cart drawer open events from common themes
  const CART_OPEN_EVENTS = [
    "cart:open",
    "shopify:section:load",
    "theme:cart:open",
    "cart-drawer:open",
    "ajaxCart.afterLoad",
  ];

  // Observe DOM mutations to detect cart drawer opening
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (
          node.nodeType === Node.ELEMENT_NODE &&
          (node.classList?.contains("cart-drawer") ||
            node.classList?.contains("cart__drawer") ||
            node.id?.includes("cart"))
        ) {
          scheduleUpsellCheck();
        }
      }

      // Also check attribute changes (e.g., aria-hidden="false" on cart)
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "aria-hidden" &&
        mutation.target.getAttribute("aria-hidden") === "false" &&
        (mutation.target.id?.includes("cart") ||
          mutation.target.className?.includes("cart"))
      ) {
        scheduleUpsellCheck();
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-hidden", "class"],
  });

  // Listen for explicit events
  CART_OPEN_EVENTS.forEach((event) => {
    document.addEventListener(event, scheduleUpsellCheck);
  });

  // Also run on initial page load if cart is already open
  document.addEventListener("DOMContentLoaded", () => {
    scheduleUpsellCheck();
  });

  function scheduleUpsellCheck() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkForUpsells, DEBOUNCE_MS);
  }

  async function checkForUpsells() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    const enabled = root.dataset.upsellEnabled !== "false";
    if (!enabled) return;

    try {
      // Fetch current cart
      const cartResponse = await fetch("/cart.js");
      const cart = await cartResponse.json();

      if (cart.item_count === 0) {
        hideUpsell(root);
        return;
      }

      // Collect variant IDs in the cart
      const cartVariantIds = new Set(
        cart.items.map((item) => `gid://shopify/ProductVariant/${item.variant_id}`),
      );

      // Look for bundle products that contain cart items
      // We do this by checking products with bundle metafields
      // This is a simplified check — in production, you'd want a
      // dedicated API endpoint that queries your bundle DB
      const upsells = await findBundleUpsells(cartVariantIds, cart.items);

      if (upsells.length === 0) {
        hideUpsell(root);
        return;
      }

      renderUpsells(root, upsells);
      showUpsell(root);
    } catch (e) {
      console.warn("MultiBundles cart upsell error:", e);
      hideUpsell(root);
    }
  }

  async function findBundleUpsells(cartVariantIds, cartItems) {
    // In a full implementation, this would call a dedicated app API endpoint:
    // GET /api/bundle-upsells?variants[]=gid://shopify/ProductVariant/123&...
    //
    // For MVP, we check if any current product page is a bundle and suggest it
    // if items from its pool are already in the cart.
    //
    // A more complete implementation would pre-fetch bundle data into a
    // window-level variable via a Liquid snippet included by the theme.

    const bundles = window.MultiBundlesCatalog || [];
    const suggestions = [];

    for (const bundle of bundles) {
      if (bundle.type === "mix_and_match" || bundle.type === "custom") {
        const poolVariantIds = new Set(
          bundle.pool.map((p) => p.variantId),
        );
        const overlap = [...cartVariantIds].filter((id) =>
          poolVariantIds.has(id),
        );
        if (overlap.length >= 1) {
          suggestions.push({
            ...bundle,
            matchedVariants: overlap,
          });
        }
      }
    }

    return suggestions;
  }

  function renderUpsells(root, upsells) {
    const container = root.querySelector("#multibundles-upsell-items");
    if (!container) return;

    const scriptEl = document.querySelector(
      'script[src*="bundle-cart.js"]',
    );
    const addLabel = scriptEl?.dataset.addLabel || "Add bundle";

    container.innerHTML = upsells
      .slice(0, 3) // Max 3 suggestions
      .map(
        (bundle) => `
        <div class="multibundles-upsell-item">
          <div class="multibundles-upsell-item-info">
            <p class="multibundles-upsell-item-title">${escapeHtml(bundle.title)}</p>
            <p class="multibundles-upsell-item-desc">Bundle price: ${escapeHtml(bundle.bundlePrice)}</p>
          </div>
          <a
            href="/products/${escapeHtml(bundle.productHandle)}"
            class="multibundles-upsell-item-btn btn button button--secondary"
          >
            ${escapeHtml(addLabel)}
          </a>
        </div>
      `,
      )
      .join("");
  }

  function showUpsell(root) {
    root.style.display = "block";
  }

  function hideUpsell(root) {
    root.style.display = "none";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }
})();
