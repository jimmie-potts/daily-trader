# Sanitized Alpaca fixtures

These fixtures are synthetic examples shaped from Alpaca's public stock-streaming
message documentation. They were not captured from a customer connection and do
not contain credentials, account identifiers, authorization requests, complete
provider sessions, or customer data.

- `control-messages.json` contains only connection, authentication-success, and
  exact AAPL/SPY bar-subscription acknowledgements.
- `aapl-spy-bars.json.txt` contains a valid JSON document stored with a text
  suffix so formatters cannot normalize away its deliberately preserved numeric
  lexemes. Its trailing-zero decimals, value larger than JavaScript's safe
  integer range, and timestamp precision variants exercise lossless decoding.
- `malformed-items.json` contains structurally incomplete or unsafe messages.
- `wrong-symbol-and-unsupported.json` proves that another symbol and updated,
  daily, trade, and quote event kinds cannot be accepted as one-minute bars.

When updating these fixtures, derive only the minimum fields needed from public
documentation, keep values synthetic, document the change here, and never paste
an authentication frame, credential, account value, or raw recorded session.
