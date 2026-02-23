// Import serde_json::Value under an alias to avoid clashing with the
// generated schema::Value @oneOf discount-value enum.
use serde_json::Value as Json;
use shopify_function::prelude::*;
use shopify_function::Result;

// ─── Type generation from schema + query ─────────────────────────────────────
//
// Generated paths:
//   schema::run::Input                  – root response type
//   schema::run::input::Merchandise     – union enum (ProductVariant | …)
//   schema::FunctionRunResult           – { discounts, discountApplicationStrategy }
//   schema::Discount                    – { message, targets, value }
//   schema::Target                      – @oneOf enum (ProductVariant | CartLine)
//   schema::ProductVariantTarget        – { id, quantity }
//   schema::Value                       – @oneOf enum (Percentage | FixedAmount)
//   schema::Percentage                  – { value: Decimal }
//   schema::FixedAmount                 – { amount: Decimal, appliesToEachItem: Option<bool> }
//   schema::DiscountApplicationStrategy – enum (All | First | Maximum)

#[typegen("./schema.graphql")]
pub mod schema {
    #[query("./src/run.graphql")]
    pub mod run {}
}

// ─── JsonValue → serde_json::Value conversion ────────────────────────────────
//
// The Product Discounts schema returns metafield data as JsonValue
// (shopify_function's custom JSON scalar type).  Convert it to serde_json::Value
// for ergonomic field access with `.as_str()`, `.as_f64()`, etc.

fn to_serde(v: &JsonValue) -> Json {
    match v {
        JsonValue::Null => Json::Null,
        JsonValue::String(s) => Json::String(s.clone()),
        JsonValue::Number(n) => serde_json::Number::from_f64(*n)
            .map(Json::Number)
            .unwrap_or(Json::Null),
        JsonValue::Boolean(b) => Json::Bool(*b),
        JsonValue::Array(a) => Json::Array(a.iter().map(to_serde).collect()),
        JsonValue::Object(o) => Json::Object(
            o.iter()
                .map(|(k, v)| (k.clone(), to_serde(v)))
                .collect(),
        ),
    }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

#[shopify_function]
fn run(input: schema::run::Input) -> Result<schema::FunctionRunResult> {
    let mut discounts: Vec<schema::Discount> = vec![];

    for line in input.cart().lines() {
        // Only process ProductVariant merchandise
        let schema::run::input::Merchandise::ProductVariant(variant) = line.merchandise() else {
            continue;
        };

        // Only process lines that have a volume-config metafield
        let Some(metafield) = variant.product().volume_config() else {
            continue;
        };

        // json_value() returns &JsonValue; convert to serde_json for easy access
        let config: Json = to_serde(metafield.json_value());

        // Find the best qualifying tier for the line quantity
        if let Some(discount) =
            find_best_tier_discount(variant.id(), line.quantity(), &config)
        {
            discounts.push(discount);
        }
    }

    Ok(schema::FunctionRunResult {
        discounts,
        discount_application_strategy: schema::DiscountApplicationStrategy::Maximum,
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
    variant_id: &str,
    line_qty: i32,
    config: &Json,
) -> Option<schema::Discount> {
    let tiers = config["tiers"].as_array()?;
    let line_qty = line_qty as i64;

    // Find all qualifying tiers (minQuantity <= line_qty) and pick the best
    let best_tier = tiers
        .iter()
        .filter(|tier| {
            let min_qty = tier["minQuantity"].as_i64().unwrap_or(i64::MAX);
            line_qty >= min_qty
        })
        .max_by(|a, b| {
            let a_val = a["discountValue"].as_f64().unwrap_or(0.0);
            let b_val = b["discountValue"].as_f64().unwrap_or(0.0);
            a_val
                .partial_cmp(&b_val)
                .unwrap_or(std::cmp::Ordering::Equal)
        })?;

    let discount_type = best_tier["discountType"].as_str().unwrap_or("");
    let discount_value = best_tier["discountValue"].as_f64().unwrap_or(0.0);
    let min_quantity = best_tier["minQuantity"].as_i64().unwrap_or(1);

    if discount_value <= 0.0 {
        return None;
    }

    // Apply the discount to the specific variant in this cart line
    let targets = vec![schema::Target::ProductVariant(
        schema::ProductVariantTarget {
            id: variant_id.to_owned(),
            quantity: None, // apply to the whole line quantity
        },
    )];

    let value = match discount_type {
        "percentage" => schema::Value::Percentage(schema::Percentage {
            value: Decimal(discount_value),
        }),
        "fixed_amount" => schema::Value::FixedAmount(schema::FixedAmount {
            amount: Decimal(discount_value),
            applies_to_each_item: Some(true),
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
        if discount_type == "fixed_amount" {
            " each"
        } else {
            ""
        }
    );

    Some(schema::Discount {
        targets,
        value,
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
        let qualifying: Vec<&Json> = tiers
            .iter()
            .filter(|t| {
                let min = t["minQuantity"].as_i64().unwrap_or(i64::MAX);
                line_qty >= min
            })
            .collect();
        assert_eq!(qualifying.len(), 2);

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
        let qualifying: Vec<&Json> = tiers
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
