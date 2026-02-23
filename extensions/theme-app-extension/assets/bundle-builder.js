/**
 * MultiBundles - Bundle Builder JS
 * ----------------------------------
 * Handles the interactive product selection widget for Mix & Match
 * and Custom bundle types.
 *
 * Responsibilities:
 * 1. Load variant names/images from the Shopify product JSON API
 * 2. Track customer selections (pool items)
 * 3. Enforce min/max selection rules
 * 4. Add parent variant to cart with _multibundles_selections line property
 */

(function () {
  "use strict";

  const SELECTIONS_KEY = "_multibundles_selections";

  document.querySelectorAll(".multibundles-builder").forEach(initBuilder);

  function initBuilder(el) {
    const bundleType = el.dataset.bundleType;
    const minSel = parseInt(el.dataset.minSelections, 10) || 1;
    const maxSel = parseInt(el.dataset.maxSelections, 10) || 1;
    const variantId = el.dataset.variantId;

    // State: Map of variantId → quantity (for counting multi-selects)
    const selections = new Map();

    const poolItems = el.querySelectorAll(".multibundles-builder__pool-item");
    const counter = el.querySelector(".multibundles-builder__selected-count");
    const addBtn = el.querySelector(".multibundles-builder__add-to-cart");
    const errorEl = el.querySelector(".multibundles-builder__error");

    // Load variant data from Shopify product JSON
    loadVariantData(el);

    // Attach click handlers to pool items
    poolItems.forEach((item) => {
      item.addEventListener("click", () => toggleItem(item));
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleItem(item);
        }
      });
    });

    // Add to cart
    addBtn.addEventListener("click", () => addBundleToCart());

    function toggleItem(item) {
      const vid = item.dataset.variantId;
      const isSelected = item.classList.contains("is-selected");
      const totalSelected = getTotalSelected();

      if (!isSelected) {
        // Adding — check max
        if (totalSelected >= maxSel) {
          showError(
            `You can select a maximum of ${maxSel} item${maxSel !== 1 ? "s" : ""}.`,
          );
          return;
        }
        item.classList.add("is-selected");
        item.setAttribute("aria-checked", "true");
        selections.set(vid, (selections.get(vid) || 0) + 1);
      } else {
        // Removing
        item.classList.remove("is-selected");
        item.setAttribute("aria-checked", "false");
        const newQty = (selections.get(vid) || 1) - 1;
        if (newQty <= 0) {
          selections.delete(vid);
        } else {
          selections.set(vid, newQty);
        }
      }

      clearError();
      updateUI();
    }

    function getTotalSelected() {
      let total = 0;
      selections.forEach((qty) => (total += qty));
      return total;
    }

    function updateUI() {
      const total = getTotalSelected();
      if (counter) counter.textContent = total;

      const isValid = total >= minSel && total <= maxSel;
      addBtn.disabled = !isValid;

      // Update status text
      const statusEl = el.querySelector(".multibundles-builder__selection-status");
      if (statusEl) {
        if (total < minSel) {
          statusEl.textContent = `Select ${minSel - total} more item${minSel - total !== 1 ? "s" : ""}`;
        } else if (total === maxSel) {
          statusEl.textContent = "Bundle complete! Ready to add to cart.";
        } else {
          statusEl.textContent = `Select up to ${maxSel - total} more item${maxSel - total !== 1 ? "s" : ""}`;
        }
      }
    }

    async function addBundleToCart() {
      const total = getTotalSelected();
      if (total < minSel || total > maxSel) {
        showError(
          `Please select ${minSel === maxSel ? minSel : minSel + "–" + maxSel} items.`,
        );
        return;
      }

      // Build selections array
      const selectionsArr = [];
      selections.forEach((qty, id) => {
        selectionsArr.push({ id, qty });
      });

      const originalLabel = addBtn.textContent;
      addBtn.textContent = addBtn.dataset.adding || "Adding...";
      addBtn.disabled = true;

      try {
        const response = await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: variantId,
            quantity: 1,
            properties: {
              [SELECTIONS_KEY]: JSON.stringify(selectionsArr),
            },
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.description || "Failed to add to cart");
        }

        // Dispatch cart:refresh event (works with most themes)
        document.dispatchEvent(new CustomEvent("cart:refresh"));
        // Also try Shopify's native event
        document.dispatchEvent(
          new CustomEvent("shopify:section:load", {
            detail: { sectionId: "cart-notification" },
          }),
        );

        // Reset selections
        selections.clear();
        poolItems.forEach((item) => {
          item.classList.remove("is-selected");
          item.setAttribute("aria-checked", "false");
        });
        updateUI();
        clearError();
      } catch (err) {
        showError(err.message || "Could not add to cart. Please try again.");
        addBtn.disabled = false;
      } finally {
        addBtn.textContent = originalLabel;
        updateUI();
      }
    }

    function showError(msg) {
      if (errorEl) {
        errorEl.textContent = msg;
        errorEl.style.display = "block";
      }
    }

    function clearError() {
      if (errorEl) {
        errorEl.textContent = "";
        errorEl.style.display = "none";
      }
    }

    // Load variant names/images from Shopify
    async function loadVariantData(container) {
      const variantEls = container.querySelectorAll(
        "[data-variant-id]",
      );
      if (variantEls.length === 0) return;

      // Collect unique product IDs by fetching variant details
      // Use the Shopify product JSON endpoint to get variant data
      // This is a simplified approach — fetches the current product
      try {
        const productHandle = document
          .querySelector("meta[name='shopify-page-type']")
          ?.getAttribute("content");
        // Fall back to product.handle from liquid
        const handle =
          window.MultiBundlesProductHandle || document.location.pathname.split("/").pop();
        const response = await fetch(`/products/${handle}.js`);
        const productData = await response.json();

        const variantMap = new Map(
          productData.variants.map((v) => [String(v.id), v]),
        );

        // Update pool item names and images
        container
          .querySelectorAll(".multibundles-builder__pool-item")
          .forEach((item) => {
            const vid = item.dataset.variantId;
            // GID → numeric ID
            const numericId = vid.split("/").pop();
            const variant = variantMap.get(numericId);

            if (variant) {
              const nameEl = item.querySelector(
                ".multibundles-builder__pool-item-name",
              );
              const imageEl = item.querySelector(
                ".multibundles-builder__pool-item-image",
              );

              if (nameEl) {
                nameEl.textContent =
                  variant.title !== "Default Title"
                    ? `${productData.title} - ${variant.title}`
                    : productData.title;
              }

              if (imageEl && variant.featured_image?.src) {
                const img = document.createElement("img");
                img.src =
                  variant.featured_image.src + "&width=200";
                img.alt = variant.featured_image.alt || variant.title;
                img.width = 80;
                img.height = 80;
                img.loading = "lazy";
                imageEl.appendChild(img);
              }
            }
          });
      } catch (e) {
        console.warn("MultiBundles: Could not load variant data", e);
      }
    }

    // Init
    updateUI();
  }
})();
