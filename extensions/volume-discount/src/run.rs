use shopify_function::prelude::*;
use shopify_function::Result;
use serde_json::Value;

// ─── Types generated from run.graphql + Product Discounts schema ─────────────
//
// shopify_function_target generates `input` and `output` modules from:
//   query_path  = "src/run.graphql"
//   schema_path = "../../node_modules/@shopify/shopify-function-targets/schemas/product_discounts/FunctionRunTarget.graphql"
//
// Input types (auto-generated):
//   input::ResponseData
//   input::Cart
//   input::CartLine (id, quantity, merchandise, cost)
//   input::CartLineMerchandise::ProductVariant (id, product)
//   input::Product (volume_config: Option<Metafield>)
//   input::Metafield (json_value: Option<JsonValue>)
//
// Output types (auto-generated):
//   output::FunctionRunResult { discounts: Vec<Discount>, discount_application_strategy }
//   output::Discount { targets, value, conditions, message }
//   output::Target::ProductVariant { id, quantity }
//   output::Value::Percentage { value } | Value::FixedAmount { applies_to_each_item, amount }
//   output::DiscountApplicationStrategy (First | Maximum)

#[shopify_function_target(
    query_path = "src/run.graphql",
    schema_path = "../../node_modules/@shopify/shopify-function-targets/schemas/product_discounts/FunctionRunTarget.graphql"
)]
fn run(input: input::ResponseData) -> Result<output::FunctionRunResult> {
    let mut discounts: Vec<output::Discount> = vec![];

    for line in &input.cart.lines {
        // Only process ProductVariant merchandise
        let input::CartLineMerchandise::ProductVariant(variant) = &line.merchandise else {
            continue;
        };

        // Only process lines that have a volume-config metafield
        let Some(metafield) = &variant.product.volume_config else {
            continue;
        };

        let Some(json_value) = &metafield.json_value else {
            continue;
        };

        // Parse the volume config JSON
        let config: Value = match serde_json::from_str(&json_value.to_string()) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Find the best qualifying tier for the line quantity
        if let Some(discount) =
            find_best_tier_discount(line, &variant.id, &config)
        {
            discounts.push(discount);
        }
    }

    Ok(output::FunctionRunResult {
        discounts,
        // Maximum: apply the highest discount when multiple could apply
        discount_application_strategy: output::DiscountApplicationStrategy::Maximum,
    })
}

// ─── Tier Matching Logic ──────────────────────────────────────────────────────
//
// Volume config metafield JSON:
// {
//   "type": "volume",
//   "tiers": [
//     { "minQuantity": 2, "discountType": "percentage", "discountValue": 10 },
//     { "minQuantity": 3, "discountType": "percentage", "discountValue": 15 },
//     { "minQuantity": 5, "discountType": "percentage", "discountValue": 25 }
//   ]
// }

fn find_best_tier_discount(
    line: &input::CartLine,
    variant_id: &str,
    config: &Value,
) -> Option<output::Discount> {
    let tiers = config["tiers"].as_array()?;
    let line_qty = line.quantity as i64;

    // Find all qualifying tiers (where minQuantity <= line_qty)
    // and pick the one with the highest discount value
    let best_tier = tiers
        .iter()
        .filter(|tier| {
            let min_qty = tier["minQuantity"].as_i64().unwrap_or(i64::MAX);
            line_qty >= min_qty
        })
        .max_by(|a, b| {
            let a_val = a["discountValue"].as_f64().unwrap_or(0.0);
            let b_val = b["discountValue"].as_f64().unwrap_or(0.0);
            a_val.partial_cmp(&b_val).unwrap_or(std::cmp::Ordering::Equal)
        })?;

    let discount_type = best_tier["discountType"].as_str().unwrap_or("");
    let discount_value = best_tier["discountValue"].as_f64().unwrap_or(0.0);
    let min_quantity = best_tier["minQuantity"].as_i64().unwrap_or(1);

    if discount_value <= 0.0 {
        return None;
    }

    // Build the target: apply to the specific variant in this cart line
    let targets = vec![output::Target::ProductVariant(output::ProductVariantTarget {
        id: variant_id.to_string().into(),
        quantity: None, // Apply to entire line quantity
    })];

    // Build the discount value
    let value = match discount_type {
        "percentage" => output::Value::Percentage(output::Percentage {
            value: format!("{:.4}", discount_value).parse().ok()?,
        }),
        "fixed_amount" => output::Value::FixedAmount(output::FixedAmount {
            amount: format!("{:.2}", discount_value).parse().ok()?,
            applies_to_each_item: true,
        }),
        _ => return None,
    };

    let message = format!(
        "Buy {}+ and save {}{}",
        min_quantity,
        if discount_type == "percentage" {
            format!("{:.0}%", discount_value)
        } else {
            format!("${:.2}", discount_value)
        },
        if discount_type == "fixed_amount" { " each" } else { "" }
    );

    Some(output::Discount {
        targets,
        value,
        conditions: None,
        message: Some(message),
    })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_no_tiers_in_config() {
        let config = json!({ "type": "volume", "tiers": [] });
        let tiers = config["tiers"].as_array().unwrap();
        assert!(tiers.is_empty());
    }

    #[test]
    fn test_tier_threshold_matching() {
        let tiers = vec![
            json!({ "minQuantity": 2, "discountType": "percentage", "discountValue": 10 }),
            json!({ "minQuantity": 3, "discountType": "percentage", "discountValue": 15 }),
            json!({ "minQuantity": 5, "discountType": "percentage", "discountValue": 25 }),
        ];

        // Qty = 4: should match tiers for 2 and 3, best is 15%
        let line_qty: i64 = 4;
        let qualifying: Vec<&Value> = tiers
            .iter()
            .filter(|t| {
                let min = t["minQuantity"].as_i64().unwrap_or(i64::MAX);
                line_qty >= min
            })
            .collect();
        assert_eq!(qualifying.len(), 2); // 2-tier and 3-tier both qualify

        let best = qualifying
            .iter()
            .max_by(|a, b| {
                let av = a["discountValue"].as_f64().unwrap_or(0.0);
                let bv = b["discountValue"].as_f64().unwrap_or(0.0);
                av.partial_cmp(&bv).unwrap()
            })
            .unwrap();
        assert_eq!(best["discountValue"].as_f64().unwrap(), 15.0);
    }

    #[test]
    fn test_tier_not_qualifying() {
        let tiers = vec![
            json!({ "minQuantity": 5, "discountType": "percentage", "discountValue": 25 }),
        ];

        // Qty = 3: does not qualify for the 5+ tier
        let line_qty: i64 = 3;
        let qualifying: Vec<&Value> = tiers
            .iter()
            .filter(|t| {
                let min = t["minQuantity"].as_i64().unwrap_or(i64::MAX);
                line_qty >= min
            })
            .collect();
        assert!(qualifying.is_empty());
    }

    #[test]
    fn test_percentage_tier_message() {
        let min_qty = 3i64;
        let discount_value = 15.0f64;
        let discount_type = "percentage";

        let message = format!(
            "Buy {}+ and save {}{}",
            min_qty,
            if discount_type == "percentage" {
                format!("{:.0}%", discount_value)
            } else {
                format!("${:.2}", discount_value)
            },
            if discount_type == "fixed_amount" { " each" } else { "" }
        );
        assert_eq!(message, "Buy 3+ and save 15%");
    }

    #[test]
    fn test_fixed_amount_tier_message() {
        let min_qty = 2i64;
        let discount_value = 5.0f64;
        let discount_type = "fixed_amount";

        let message = format!(
            "Buy {}+ and save {}{}",
            min_qty,
            if discount_type == "percentage" {
                format!("{:.0}%", discount_value)
            } else {
                format!("${:.2}", discount_value)
            },
            if discount_type == "fixed_amount" { " each" } else { "" }
        );
        assert_eq!(message, "Buy 2+ and save $5.00 each");
    }
}
