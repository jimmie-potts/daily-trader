# Portable Recording Fixtures

`synthetic-aapl-spy-session-v1.json` is a deterministic Phase 2 portable recording generated through the application-owned event constructor and recording exporter.

The fixture is entirely synthetic. It contains no provider control frame, raw provider payload, credential, account identifier, customer data, or market fact. Its prices and volumes are invented solely for tests.

The ordered session includes both approved instruments, an AAPL minute gap, a later AAPL correction, and a subsequently received out-of-order AAPL bar. Every ledger event ID is unique; duplicate delivery is exercised by replaying the same verified recording more than once. The manifest records the 120-second effective freshness threshold used to reproduce late/fresh classification.

Do not replace the canonical event objects with provider frames. When the recording format or event schema changes, regenerate the fixture through `exportPortableRecording`, review its provenance, and commit the new checksum intentionally.
