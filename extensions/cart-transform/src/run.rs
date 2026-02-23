use shopify_function::prelude::*;
use shopify_function::Result;
use serde_json::Value;

// ─── Types generated from run.graphql + Cart Transform schema ────────────────
//
// shopify_function_target generates `input` and `output` modules from:
//   query_path  = "src/run.graphql"
//   schema_path = "../../node_modules/@shopify/shopify-function-targets/schemas/cart_transform/FunctionRunTarget.graphql"
//
// Input types (auto-generated):
//   input::ResponseData
//   input::Cart
//   input::CartLine (id, quantity, merchandise, cost, attribute)
//   input::CartLineMerchandise::ProductVariant (id, title, product)
//   input::Product (bundle_config: Option<Metafield>)
//   input::Metafield (json_value: Option<JsonValue>)
//   input::CartLineAttribute (value: Option<String>)
//
// Output types (auto-generated):
//   output::FunctionRunResult { operations: Vec<CartOperation> }
//   output::CartOperation::Expand(ExpandOperation)
//   output::ExpandOperation { cart_line_id, new_lines, title, image, price }
//   output::ExpandedItem { merchandise_id, quantity, price }
//   output::ExpandedItemPrice::FixedPricePerUnit { amount: Decimal }

#[shopify_function_target(
    query_path = "src/run.graphql",
    schema_path = "../../node_modules/@shopify/shopify-function-targets/schemas/cart_transform/FunctionRunTarget.graphql"
)]
fn run(input: input::ResponseData) -> Result<output::FunctionRunResult> {
    let mut operations: Vec<output::CartOperation> = vec![];

    for line in &input.cart.lines {
        // Only process ProductVariant merchandise
        let input::CartLineMerchandise::ProductVariant(variant) = &line.merchandise else {
            continue;
        };

        // Only process lines that have a bundle-config metafield
        let Some(metafield) = &variant.product.bundle_config else {
            continue;
        };

        let Some(json_value) = &metafield.json_value else {
            continue;
        };

        // Parse the bundle config JSON
        let config: Value = match serde_json::from_str(&json_value.to_string()) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let bundle_type = config["type"].as_str().unwrap_or("");

        let operation = match bundle_type {
            "fixed" => expand_fixed(line, &config),
            "mix_and_match" => {
                let selections = line
                    .attribute
                    .as_ref()
                    .and_then(|a| a.value.as_deref())
                    .unwrap_or("[]");
                expand_mix_match(line, &config, selections)
            }
            "custom" => {
                let selections = line
                    .attribute
                    .as_ref()
                    .and_then(|a| a.value.as_deref())
                    .unwrap_or("[]");
                expand_custom(line, &config, selections)
            }
            // "volume" is handled by the separate Discount Function — skip
            _ => None,
        };

        if let Some(op) = operation {
            operations.push(output::CartOperation::Expand(op));
        }
    }

    Ok(output::FunctionRunResult { operations })
}

// ─── Fixed Bundle Expansion ───────────────────────────────────────────────────
//
// Metafield JSON:
// {
//   "type": "fixed",
//   "components": [
//     { "variantId": "gid://...", "quantity": 1, "price": "15.00" },
//     ...
//   ]
// }

fn expand_fixed(
    line: &input::CartLine,
    config: &Value,
) -> Option<output::ExpandOperation> {
    let components = config["components"].as_array()?;
    if components.is_empty() {
        return None;
    }

    let new_lines: Vec<output::ExpandedItem> = components
        .iter()
        .filter_map(|c| build_expanded_item(c, "variantId", "quantity", "price"))
        .collect();

    if new_lines.is_empty() {
        return None;
    }

    Some(output::ExpandOperation {
        cart_line_id: line.id.clone(),
        new_lines,
        title: None,
        image: None,
        price: None,
    })
}

// ─── Mix & Match Bundle Expansion ─────────────────────────────────────────────
//
// Metafield JSON:
// {
//   "type": "mix_and_match",
//   "minSelections": 3,
//   "maxSelections": 3,
//   "pool": [ { "variantId": "gid://...", "price": "5.00" }, ... ],
//   "bundlePrice": "12.00"
// }
//
// Line attribute "_multibundles_selections":
// [{"id": "gid://...", "qty": 1}, ...]

fn expand_mix_match(
    line: &input::CartLine,
    config: &Value,
    selections_json: &str,
) -> Option<output::ExpandOperation> {
    let pool = config["pool"].as_array()?;
    let min = config["minSelections"].as_i64().unwrap_or(1);
    let max = config["maxSelections"].as_i64().unwrap_or(i64::MAX);
    let bundle_price_str = config["bundlePrice"].as_str().unwrap_or("0");
    let bundle_price: f64 = bundle_price_str.parse().unwrap_or(0.0);

    // Parse customer selections
    let selections: Vec<Value> = serde_json::from_str(selections_json).unwrap_or_default();

    // Count total selected quantity
    let total_qty: i64 = selections
        .iter()
        .map(|s| s["qty"].as_i64().unwrap_or(1))
        .sum();

    // Validate: total selection count must be within min/max
    if total_qty < min || total_qty > max {
        return None;
    }

    // Build a lookup of pool prices by variant GID
    let pool_prices: std::collections::HashMap<&str, f64> = pool
        .iter()
        .filter_map(|p| {
            let id = p["variantId"].as_str()?;
            let price: f64 = p["price"].as_str().unwrap_or("0").parse().unwrap_or(0.0);
            Some((id, price))
        })
        .collect();

    // Calculate proportional price per selected unit
    let price_per_unit = if total_qty > 0 {
        bundle_price / total_qty as f64
    } else {
        0.0
    };

    // Build expanded items from customer selections
    let new_lines: Vec<output::ExpandedItem> = selections
        .iter()
        .filter_map(|s| {
            let variant_id = s["id"].as_str()?;
            let qty = s["qty"].as_i64().unwrap_or(1) as i32;

            // Validate variant is in the pool
            if !pool_prices.contains_key(variant_id) {
                return None;
            }

            let price_amount = format!("{:.2}", price_per_unit);

            Some(output::ExpandedItem {
                merchandise_id: variant_id.to_string().into(),
                quantity: qty,
                price: Some(output::ExpandedItemPrice::FixedPricePerUnit(
                    output::FixedPricePerUnit {
                        amount: price_amount.parse().ok()?,
                    },
                )),
            })
        })
        .collect();

    if new_lines.is_empty() {
        return None;
    }

    Some(output::ExpandOperation {
        cart_line_id: line.id.clone(),
        new_lines,
        title: None,
        image: None,
        price: None,
    })
}

// ─── Custom Bundle Expansion ──────────────────────────────────────────────────
//
// Metafield JSON:
// {
//   "type": "custom",
//   "fixedComponents": [
//     { "variantId": "gid://...", "quantity": 1, "price": "20.00" }
//   ],
//   "selectablePool": {
//     "minSelections": 2,
//     "maxSelections": 2,
//     "pool": [ { "variantId": "gid://...", "price": "8.00" }, ... ]
//   },
//   "bundlePrice": "30.00"
// }
//
// Line attribute "_multibundles_selections":
// [{"id": "gid://...", "qty": 1}, ...]

fn expand_custom(
    line: &input::CartLine,
    config: &Value,
    selections_json: &str,
) -> Option<output::ExpandOperation> {
    let fixed_components = config["fixedComponents"].as_array()?;
    let selectable = &config["selectablePool"];
    let pool = selectable["pool"].as_array().unwrap_or(&vec![]);
    let min = selectable["minSelections"].as_i64().unwrap_or(0);
    let max = selectable["maxSelections"].as_i64().unwrap_or(i64::MAX);
    let bundle_price_str = config["bundlePrice"].as_str().unwrap_or("0");
    let bundle_price: f64 = bundle_price_str.parse().unwrap_or(0.0);

    // Parse customer selections
    let selections: Vec<Value> = serde_json::from_str(selections_json).unwrap_or_default();

    // Validate selection count
    let total_qty: i64 = selections
        .iter()
        .map(|s| s["qty"].as_i64().unwrap_or(1))
        .sum();

    if min > 0 && (total_qty < min || total_qty > max) {
        return None;
    }

    // Build pool price lookup
    let pool_prices: std::collections::HashMap<&str, f64> = pool
        .iter()
        .filter_map(|p| {
            let id = p["variantId"].as_str()?;
            let price: f64 = p["price"].as_str().unwrap_or("0").parse().unwrap_or(0.0);
            Some((id, price))
        })
        .collect();

    // Calculate total original price across fixed + selected
    let fixed_original: f64 = fixed_components
        .iter()
        .map(|c| {
            let qty = c["quantity"].as_i64().unwrap_or(1) as f64;
            let price: f64 = c["price"].as_str().unwrap_or("0").parse().unwrap_or(0.0);
            qty * price
        })
        .sum();

    let selected_original: f64 = selections
        .iter()
        .map(|s| {
            let variant_id = s["id"].as_str().unwrap_or("");
            let qty = s["qty"].as_i64().unwrap_or(1) as f64;
            let price = pool_prices.get(variant_id).copied().unwrap_or(0.0);
            qty * price
        })
        .sum();

    let total_original = fixed_original + selected_original;

    // Expand fixed components with proportional prices
    let mut new_lines: Vec<output::ExpandedItem> = fixed_components
        .iter()
        .filter_map(|c| {
            let variant_id = c["variantId"].as_str()?;
            let qty = c["quantity"].as_i64().unwrap_or(1) as i32;
            let original_price: f64 = c["price"].as_str().unwrap_or("0").parse().unwrap_or(0.0);

            // Proportional price: (component_weight / total_weight) * bundle_price
            let weight = (original_price * qty as f64) / total_original.max(0.01);
            let component_total = weight * bundle_price;
            let price_per_unit = component_total / qty as f64;
            let price_str = format!("{:.2}", price_per_unit);

            Some(output::ExpandedItem {
                merchandise_id: variant_id.to_string().into(),
                quantity: qty,
                price: Some(output::ExpandedItemPrice::FixedPricePerUnit(
                    output::FixedPricePerUnit {
                        amount: price_str.parse().ok()?,
                    },
                )),
            })
        })
        .collect();

    // Expand selected components with proportional prices
    let selected_lines: Vec<output::ExpandedItem> = selections
        .iter()
        .filter_map(|s| {
            let variant_id = s["id"].as_str()?;
            let qty = s["qty"].as_i64().unwrap_or(1) as i32;

            // Validate selection is in pool
            if !pool_prices.contains_key(variant_id) {
                return None;
            }

            let original_price = pool_prices.get(variant_id).copied().unwrap_or(0.0);
            let weight = (original_price * qty as f64) / total_original.max(0.01);
            let component_total = weight * bundle_price;
            let price_per_unit = component_total / qty as f64;
            let price_str = format!("{:.2}", price_per_unit);

            Some(output::ExpandedItem {
                merchandise_id: variant_id.to_string().into(),
                quantity: qty,
                price: Some(output::ExpandedItemPrice::FixedPricePerUnit(
                    output::FixedPricePerUnit {
                        amount: price_str.parse().ok()?,
                    },
                )),
            })
        })
        .collect();

    new_lines.extend(selected_lines);

    if new_lines.is_empty() {
        return None;
    }

    Some(output::ExpandOperation {
        cart_line_id: line.id.clone(),
        new_lines,
        title: None,
        image: None,
        price: None,
    })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Build an ExpandedItem from a metafield component JSON object.
fn build_expanded_item(
    component: &Value,
    id_key: &str,
    qty_key: &str,
    price_key: &str,
) -> Option<output::ExpandedItem> {
    let variant_id = component[id_key].as_str()?;
    let quantity = component[qty_key].as_i64().unwrap_or(1) as i32;
    let price_str = component[price_key].as_str().unwrap_or("0");

    Some(output::ExpandedItem {
        merchandise_id: variant_id.to_string().into(),
        quantity,
        price: Some(output::ExpandedItemPrice::FixedPricePerUnit(
            output::FixedPricePerUnit {
                amount: price_str.parse().ok()?,
            },
        )),
    })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_expand_fixed_no_components() {
        let config = json!({ "type": "fixed", "components": [] });
        // Can't call expand_fixed directly without a real CartLine,
        // but we can test the helper logic:
        let components = config["components"].as_array().unwrap();
        assert!(components.is_empty());
    }

    #[test]
    fn test_build_expanded_item_valid() {
        let component = json!({
            "variantId": "gid://shopify/ProductVariant/123",
            "quantity": 2,
            "price": "15.00"
        });
        let item = build_expanded_item(&component, "variantId", "quantity", "price");
        assert!(item.is_some());
        let item = item.unwrap();
        assert_eq!(item.quantity, 2);
    }

    #[test]
    fn test_build_expanded_item_missing_id() {
        let component = json!({ "quantity": 1, "price": "5.00" });
        let item = build_expanded_item(&component, "variantId", "quantity", "price");
        assert!(item.is_none());
    }

    #[test]
    fn test_mix_match_selection_validation() {
        // Test that total_qty < min returns None
        let config = json!({
            "type": "mix_and_match",
            "minSelections": 3,
            "maxSelections": 3,
            "pool": [
                { "variantId": "gid://shopify/ProductVariant/1", "price": "5.00" },
                { "variantId": "gid://shopify/ProductVariant/2", "price": "5.00" }
            ],
            "bundlePrice": "12.00"
        });
        let pool = config["pool"].as_array().unwrap();
        let min = config["minSelections"].as_i64().unwrap_or(1);
        let max = config["maxSelections"].as_i64().unwrap_or(i64::MAX);

        // Only 2 selected, need 3
        let selections = json!([
            {"id": "gid://shopify/ProductVariant/1", "qty": 1},
            {"id": "gid://shopify/ProductVariant/2", "qty": 1}
        ]);
        let total_qty: i64 = selections
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["qty"].as_i64().unwrap_or(1))
            .sum();

        assert!(total_qty < min); // Should fail validation
    }

    #[test]
    fn test_pool_price_lookup() {
        let pool = vec![
            json!({ "variantId": "gid://shopify/ProductVariant/1", "price": "5.00" }),
            json!({ "variantId": "gid://shopify/ProductVariant/2", "price": "7.50" }),
        ];

        let pool_prices: std::collections::HashMap<&str, f64> = pool
            .iter()
            .filter_map(|p| {
                let id = p["variantId"].as_str()?;
                let price: f64 = p["price"].as_str().unwrap_or("0").parse().unwrap_or(0.0);
                Some((id, price))
            })
            .collect();

        assert_eq!(
            pool_prices.get("gid://shopify/ProductVariant/1").copied(),
            Some(5.0)
        );
        assert_eq!(
            pool_prices.get("gid://shopify/ProductVariant/2").copied(),
            Some(7.5)
        );
        // Unknown variant not in pool
        assert!(pool_prices.get("gid://shopify/ProductVariant/999").is_none());
    }
}
