/// Local development entry point — not used directly; the Shopify CLI
/// runs the compiled Wasm binary instead.
///
/// To test this function locally:
///   shopify app function run --input src/test_volume.json
fn main() {
    eprintln!(
        "Use `shopify app function run --input <fixture.json>` for local testing.\n\
         Compile to Wasm with `cargo build --release --target wasm32-unknown-unknown`."
    );
}
