/// Local test runner — reads JSON from stdin and writes result to stdout.
/// Used with `shopify app function run` during development.
fn main() {
    cart_transform::function(std::io::stdin(), std::io::stdout())
        .expect("function to not fail");
}
