# MultiBundles — Launch Checklist & QA Guide

## Pre-Launch Checklist

### 1. Environment Setup
- [ ] Copy `.env.example` → `.env` and fill in Shopify API credentials
- [ ] Confirm `shopify app dev` starts without errors
- [ ] Confirm embedded admin loads in your development store

### 2. Database
- [ ] `npx prisma migrate deploy` — all migrations applied cleanly
- [ ] `npm run seed` — dev seed data loads without errors
- [ ] Open `/app/bundles` — seed bundles visible in admin UI

### 3. Shopify Functions — Local Testing

#### Cart Transform (Fixed, Mix & Match, Custom)
```bash
cd extensions/cart-transform
# Fixed bundle expansion
shopify app function run --input src/test_fixed.json
# Expected: linesExpand with 2 component lines, prices sum to $30.00

# Mix & Match with valid selections
shopify app function run --input src/test_mix_match.json
# Expected: linesExpand with 3 selected components

# Mix & Match with invalid selections (variant not in pool)
shopify app function run --input src/test_mix_match_invalid.json
# Expected: NO expansion (parent line returned as-is)

# Custom bundle (fixed + selected)
shopify app function run --input src/test_custom.json
# Expected: linesExpand with fixed component + selected components

# Non-bundle product
shopify app function run --input src/test_no_bundle.json
# Expected: no operations (empty result)

# Mixed cart (fixed bundle + regular item + mix-match bundle)
shopify app function run --input src/test_mixed_cart.json
# Expected: 2 bundles expanded, regular item unchanged
```

#### Volume Discount Function
```bash
cd extensions/volume-discount
# Quantity qualifies for tier (qty=3, should get 15% off)
shopify app function run --input src/test_volume_qty3.json
# Expected: 15% discount applied to the line

# Quantity does not qualify (qty=1, no tier threshold met)
shopify app function run --input src/test_volume_no_tier.json
# Expected: no discount applied
```

#### Wasm Binary Size Check
```bash
# After building, verify both binaries are under 256KB
du -h extensions/cart-transform/target/wasm32-unknown-unknown/release/cart_transform.wasm
du -h extensions/volume-discount/target/wasm32-unknown-unknown/release/volume_discount.wasm
```

---

## E2E QA Checklist (per bundle type)

### Fixed Bundle
- [ ] Create fixed bundle via admin UI
  - [ ] Parent product selected
  - [ ] 2+ components added with quantities
  - [ ] Discount type: percentage / fixed amount / manual price — all work
  - [ ] Price preview shows correct proportional distribution
  - [ ] Save → bundle appears in bundle list
- [ ] Activate bundle
- [ ] Go to dev store → product page → add to cart
- [ ] Checkout → verify Cart Transform expanded parent into component lines
- [ ] Verify component prices sum to bundle price (penny-perfect)
- [ ] Complete order → verify inventory decremented on all components

### Mix & Match Bundle
- [ ] Create mix-and-match bundle
  - [ ] Pool of 5+ variants configured
  - [ ] Min/max selections: 3/3
  - [ ] Bundle price set
- [ ] Activate bundle
- [ ] Go to dev store → product page → bundle-builder block present
- [ ] Select exactly 3 items → "Add to Cart" button enabled
- [ ] Select 4 items → "Add to Cart" button disabled (max enforced)
- [ ] Select 2 items → "Add to Cart" disabled (min enforced)
- [ ] Add to cart with valid 3 selections
- [ ] Checkout → verify Cart Transform expanded to the 3 selected variants
- [ ] Invalid attempt: manually edit `_multibundles_selections` to include unknown variant
  → parent line NOT expanded (graceful no-op)

### Volume / Tiered Bundle
- [ ] Create volume bundle with 3 tiers (2x→10%, 3x→15%, 5x→25%)
- [ ] Activate
- [ ] Dev store → add 1 unit → no discount shown
- [ ] Dev store → add 2 units → 10% discount applied at checkout
- [ ] Dev store → add 3 units → 15% discount applied
- [ ] Dev store → add 5 units → 25% discount applied
- [ ] Verify correct tier used (not just the first)

### Custom Bundle
- [ ] Requires Global plan (verify free/launch users cannot access form)
- [ ] Create custom bundle
  - [ ] 1 fixed component (always included)
  - [ ] Pool of 3 selectable variants
  - [ ] Selection rules: pick exactly 2
  - [ ] Bundle price set
- [ ] Activate
- [ ] Dev store → bundle-builder block shows fixed component + selectable pool
- [ ] Customer picks 2 from pool → adds to cart
- [ ] Checkout → fixed component + 2 selected components all present
- [ ] Prices proportionally distributed (fixed + selected, sum = bundle price)

---

## Plan Gating QA

- [ ] Free plan: can create 1-3 fixed bundles → 4th attempt shows upgrade banner
- [ ] Free plan: Mix & Match / Volume / Custom routes redirect to type selector
- [ ] Launch plan: unlimited fixed, mix-match, volume bundles allowed
- [ ] Launch plan: Custom route still redirects
- [ ] Global plan: all 4 bundle types accessible
- [ ] Billing page: subscribing to Launch → plan badge updates to "Launch"
- [ ] Billing page: upgrading to Global → Custom bundles now accessible
- [ ] APP_SUBSCRIPTIONS_UPDATE webhook: cancel subscription → plan reverts to free

---

## Multi-Market Pricing QA (Global plan)

- [ ] Bundle pricing page accessible only on Global plan
- [ ] Non-Global plan → UpgradeBanner shown
- [ ] Set price override for EUR market with ".99" rounding
- [ ] Verify Shopify PriceList updated (check via Shopify admin → Markets)
- [ ] Checkout from EU context → price shows rounded EUR override
- [ ] Remove override → PriceList reverts to auto-converted price

---

## Webhook QA

- [ ] `orders/create` → inventory recalculated for all fixed bundles
- [ ] `inventory_levels/update` → affected bundles' parent stock synced
- [ ] `app/uninstalled` → shop data cleaned up
- [ ] `app_subscriptions/update` → plan updated in DB
- [ ] GDPR compliance webhooks → respond 200 within 1s

---

## Theme Extension QA

- [ ] `bundle-display` block renders component grid on fixed bundle product page
- [ ] `bundle-builder` block renders interactive picker on mix-and-match product page
- [ ] `volume-tiers` block renders discount tier table on volume product page
- [ ] `cart-upsell` embed block appears in cart drawer with relevant suggestions
- [ ] All blocks work on mobile (375px viewport)
- [ ] All JS works when loaded after DOMContentLoaded (theme defer)

---

## Production Deployment Prep

### Switch to Supabase PostgreSQL
1. Create a Supabase project at https://supabase.com
2. Copy the connection strings from **Project Settings → Database → Connection string**
3. Update `.env`:
   ```
   DATABASE_URL="postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
   DIRECT_URL="postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:5432/postgres"
   ```
4. Update `prisma/schema.prisma`:
   - Change `provider = "sqlite"` → `provider = "postgresql"`
   - Add `directUrl = env("DIRECT_URL")`
5. Run: `npx prisma migrate deploy`
6. Verify tables created in Supabase table editor

### App Store Listing
- [ ] App icon (1200×1200, PNG)
- [ ] Screenshots (1600×900, PNG) — one per bundle type (4 minimum)
- [ ] Demo video (60-90 seconds) showing each bundle type in action
- [ ] Short description (≤160 chars)
- [ ] Long description (feature list, use cases, FAQ)
- [ ] Privacy policy URL (point to `/privacy-policy` route or external page)
- [ ] Support email configured in Partners dashboard

### Final Deploy Steps
```bash
# 1. Deploy the app to production
shopify app deploy

# 2. Register all webhooks with Shopify
shopify app webhooks register

# 3. Verify both function extensions are deployed
shopify app function list
```

---

## Performance Targets

| Metric | Target | How to Verify |
|---|---|---|
| Cart Transform Wasm size | < 256 KB | `du -h *.wasm` |
| Cart Transform instructions | < 11M | `shopify app function run --json` |
| Volume Discount Wasm size | < 256 KB | `du -h *.wasm` |
| Admin page load (bundle list) | < 1.5s | Browser DevTools → Network |
| Metafield sync latency | < 500ms | Server logs |
| Inventory sync latency | < 2s | Server logs after webhook |
