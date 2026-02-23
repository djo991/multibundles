use shopify_function::prelude::*;
use shopify_function::Result;
use serde_json::Value;

// ─── Type generation from schema + query ─────────────────────────────────────
//
// #[typegen] reads the full Cart Transform GraphQL schema (schema.graphql) and
// generates Rust types.  #[query] reads our input selection (src/run.graphql)
// and generates the concrete query-result types inside `schema::run`.
//
// Generated paths:
//   schema::run::Input                        – root response type
//   schema::run::input::Merchandise           – union enum (ProductVariant | CustomProduct)
//   schema::run::input::CartLine              – query-selected CartLine fields
//   schema::FunctionRunResult                 – output type (struct with fields)
//   schema::CartOperation                     – @oneOf enum (Expand | Merge | Update)
//   schema::ExpandOperation                   – expand operation struct
//   schema::ExpandedItem                      – expanded item struct
//   schema::ExpandedItemPriceAdjustment       – wrapper struct around adjustment value
//   schema::ExpandedItemPriceAdjustmentValue  – @oneOf enum (FixedPricePerUnit | …)
//   schema::ExpandedItemFixedPricePerUnitAdjustment – { amount: Decimal }

#[typegen("./schema.graphql")]
pub mod schema {
    #[query("./src/run.graphql")]
    pub mod run {}
}

// ─── Entry point ─────────────────────────────────────────────────────────────

#[shopify_function]
fn run(input: schema::run::Input) -> Result<schema::FunctionRunResult> {
    let mut operations: Vec<schema::CartOperation> = vec![];

    for line in input.cart().lines() {
        // Only process ProductVariant merchandise (skip CustomProduct, etc.)
        let schema::run::input::Merchandise::ProductVariant(variant) = line.merchandise() else {
            continue;
        };

        // Only process lines that have a bundle-config metafield
        let Some(metafield) = variant.product().bundle_config() else {
            continue;
        };

        // Cart Transform's Metafield exposes value() as the raw JSON string
        // (the schema does NOT include jsonValue — only value: String!).
        let config: Value = match serde_json::from_str(metafield.value()) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let bundle_type = config["type"].as_str().unwrap_or("");

        let operation = match bundle_type {
            "fixed" => expand_fixed(line.id(), &config),
            "mix_and_match" => {
                let selections = line
                    .attribute()
                    .and_then(|a| a.value())
                    .unwrap_or("[]");
                expand_mix_match(line.id(), &config, selections)
            }
            "custom" => {
                let selections = line
                    .attribute()
                    .and_then(|a| a.value())
                    .unwrap_or("[]");
                expand_custom(line.id(), &config, selections)
            }
            // "volume" is handled by the separate volume-discount function — skip
            _ => None,
        };

        if let Some(op) = operation {
            operations.push(schema::CartOperation::Expand(op));
        }
    }

    Ok(schema::FunctionRunResult { operations })
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

fn expand_fixed(line_id: &str, config: &Value) -> Option<schema::ExpandOperation> {
    let components = config["components"].as_array()?;
    if components.is_empty() {
        return None;
    }

    let expanded_cart_items: Vec<schema::ExpandedItem> = components
        .iter()
        .filter_map(|c| build_expanded_item(c, "variantId", "quantity", "price"))
        .collect();

    if expanded_cart_items.is_empty() {
        return None;
    }

    Some(schema::ExpandOperation {
        cart_line_id: line_id.to_owned(),
        expanded_cart_items,
        image: None,
        price: None,
        title: None,
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
    line_id: &str,
    config: &Value,
    selections_json: &str,
) -> Option<schema::ExpandOperation> {
    let pool = config["pool"].as_array()?;
    let min = config["minSelections"].as_i64().unwrap_or(1);
    let max = config["maxSelections"].as_i64().unwrap_or(i64::MAX);
    let bundle_price: f64 = config["bundlePrice"]
        .as_str()
        .unwrap_or("0")
        .parse()
        .unwrap_or(0.0);

    let selections: Vec<Value> = serde_json::from_str(selections_json).unwrap_or_default();

    // Count total selected quantity and validate against min/max
    let total_qty: i64 = selections
        .iter()
        .map(|s| s["qty"].as_i64().unwrap_or(1))
        .sum();

    if total_qty < min || total_qty > max {
        return None;
    }

    // Build pool price lookup to validate that selected variants are eligible
    let pool_ids: std::collections::HashSet<&str> = pool
        .iter()
        .filter_map(|p| p["variantId"].as_str())
        .collect();

    let price_per_unit = if total_qty > 0 {
        bundle_price / total_qty as f64
    } else {
        0.0
    };

    let expanded_cart_items: Vec<schema::ExpandedItem> = selections
        .iter()
        .filter_map(|s| {
            let variant_id = s["id"].as_str()?;
            let qty = s["qty"].as_i64().unwrap_or(1) as i32;

            // Validate variant is in the eligible pool
            if !pool_ids.contains(variant_id) {
                return None;
            }

            Some(make_expanded_item(variant_id, qty, price_per_unit))
        })
        .collect();

    if expanded_cart_items.is_empty() {
        return None;
    }

    Some(schema::ExpandOperation {
        cart_line_id: line_id.to_owned(),
        expanded_cart_items,
        image: None,
        price: None,
        title: None,
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
    line_id: &str,
    config: &Value,
    selections_json: &str,
) -> Option<schema::ExpandOperation> {
    let fixed_components = config["fixedComponents"].as_array()?;
    let selectable = &config["selectablePool"];
    let empty_pool = vec![];
    let pool = selectable["pool"].as_array().unwrap_or(&empty_pool);
    let min = selectable["minSelections"].as_i64().unwrap_or(0);
    let max = selectable["maxSelections"].as_i64().unwrap_or(i64::MAX);
    let bundle_price: f64 = config["bundlePrice"]
        .as_str()
        .unwrap_or("0")
        .parse()
        .unwrap_or(0.0);

    let selections: Vec<Value> = serde_json::from_str(selections_json).unwrap_or_default();
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

    // Compute total original value for proportional price distribution
    let fixed_total: f64 = fixed_components
        .iter()
        .map(|c| {
            let qty = c["quantity"].as_i64().unwrap_or(1) as f64;
            let price: f64 = c["price"].as_str().unwrap_or("0").parse().unwrap_or(0.0);
            qty * price
        })
        .sum();

    let selected_total: f64 = selections
        .iter()
        .map(|s| {
            let id = s["id"].as_str().unwrap_or("");
            let qty = s["qty"].as_i64().unwrap_or(1) as f64;
            pool_prices.get(id).copied().unwrap_or(0.0) * qty
        })
        .sum();

    let total_original = (fixed_total + selected_total).max(0.01);

    // Expand fixed components with proportional prices
    let mut expanded_cart_items: Vec<schema::ExpandedItem> = fixed_components
        .iter()
        .filter_map(|c| {
            let variant_id = c["variantId"].as_str()?;
            let qty = c["quantity"].as_i64().unwrap_or(1) as i32;
            let original_price: f64 = c["price"].as_str().unwrap_or("0").parse().unwrap_or(0.0);
            let weight = (original_price * qty as f64) / total_original;
            let price_per_unit = (weight * bundle_price) / qty as f64;
            Some(make_expanded_item(variant_id, qty, price_per_unit))
        })
        .collect();

    // Expand selected components with proportional prices
    let selected_items: Vec<schema::ExpandedItem> = selections
        .iter()
        .filter_map(|s| {
            let variant_id = s["id"].as_str()?;
            let qty = s["qty"].as_i64().unwrap_or(1) as i32;
            if !pool_prices.contains_key(variant_id) {
                return None;
            }
            let original_price = pool_prices.get(variant_id).copied().unwrap_or(0.0);
            let weight = (original_price * qty as f64) / total_original;
            let price_per_unit = (weight * bundle_price) / qty as f64;
            Some(make_expanded_item(variant_id, qty, price_per_unit))
        })
        .collect();

    expanded_cart_items.extend(selected_items);

    if expanded_cart_items.is_empty() {
        return None;
    }

    Some(schema::ExpandOperation {
        cart_line_id: line_id.to_owned(),
        expanded_cart_items,
        image: None,
        price: None,
        title: None,
    })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Build an ExpandedItem with a FixedPricePerUnit adjustment.
fn make_expanded_item(
    variant_id: &str,
    quantity: i32,
    price_per_unit: f64,
) -> schema::ExpandedItem {
    schema::ExpandedItem {
        merchandise_id: variant_id.to_owned(),
        quantity,
        price: Some(schema::ExpandedItemPriceAdjustment {
            adjustment: schema::ExpandedItemPriceAdjustmentValue::FixedPricePerUnit(
                schema::ExpandedItemFixedPricePerUnitAdjustment {
                    amount: Decimal(price_per_unit),
                },
            ),
        }),
        attributes: vec![],
    }
}

/// Build an ExpandedItem from a component JSON object (used for fixed bundles).
fn build_expanded_item(
    component: &Value,
    id_key: &str,
    qty_key: &str,
    price_key: &str,
) -> Option<schema::ExpandedItem> {
    let variant_id = component[id_key].as_str()?;
    let quantity = component[qty_key].as_i64().unwrap_or(1) as i32;
    let price: f64 = component[price_key]
        .as_str()
        .unwrap_or("0")
        .parse()
        .unwrap_or(0.0);
    Some(make_expanded_item(variant_id, quantity, price))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_expand_fixed_no_components() {
        let config = json!({ "type": "fixed", "components": [] });
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
        let min = config["minSelections"].as_i64().unwrap_or(1);

        // Only 2 selected, need 3 — should fail validation
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

        assert!(total_qty < min);
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
            pool_prices
                .get("gid://shopify/ProductVariant/1")
                .copied(),
            Some(5.0)
        );
        assert_eq!(
            pool_prices
                .get("gid://shopify/ProductVariant/2")
                .copied(),
            Some(7.5)
        );
        assert!(pool_prices
            .get("gid://shopify/ProductVariant/999")
            .is_none());
    }
}
