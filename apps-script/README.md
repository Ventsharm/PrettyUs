# PrettyUs Avon order receiver

Website: `https://www.prettyus.co.uk/submit-avon-order.html`.

The private Apps Script project is **Avon orders**, ID
`1IWX0dzoqXw2fy1r5oPCp6Lb2h7OZUZ3LjdLLLne4NPvzRvpIF4Ub74Nk`.
Its public receiver is the form's `action` URL. The source here is a recovery
backup, not a credential. Never add OAuth client files, tokens, customer records
or script-property values to this repository.

## Configuration and access

- Existing spreadsheet: `1aCU18Hzss3D1j08WII0AJwsi5IKopz59skx8Un4dltc`, existing tab `Sheet1`.
- Six existing headings are checked after trimming surrounding whitespace:
  Full name, Email, Street, Town, Post code, Avon items. They are not rewritten.
- Deployment: web app, execute as deploying owner, access `ANYONE_ANONYMOUS`.
  This permits customers to submit through the handler, not read the spreadsheet.
- The owner runs `verifyOrderSheet` once in the editor to authorise spreadsheet
  access and enable the receiver. This function adds no order rows.
- `doGet` reports readiness only. It never exposes rows or customer details.
- A new saved script version must be assigned to the existing deployment after
  server-code changes. Saving editor code alone does not update `/exec`.
- Google account/OAuth authorisation uses the existing custom Desktop client.
  There are no Firebase changes, new spreadsheets, paid services or email services.

## Submission and confirmation

The form uses a normal URL-encoded POST into its hidden iframe, avoiding CORS
preflight. The response is an HtmlService page that posts a minimal receipt to
the allowed PrettyUs origin. The page validates Google's message origin and the
unpredictable, per-submission request ID. An iframe load, HTTP response alone or
`no-cors` fetch resolution is never treated as proof of a saved order.

Success is acknowledged only after appending the six cells and flushing the
spreadsheet write. Field order is fixed on the server. All fields have size and
format limits; the town must be Hailsham or Hellingly. Formula-like values are
stored as literal text. A honeypot, payload limit, global cap of 120 orders per
UK day and cap of five per email/day provide basic abuse controls. These public
form controls do not prevent determined denial of service; requests can exhaust
Google's free quotas. Limits can be adjusted in `Code.gs` with a new deployment.

A script lock serialises writes. Private short-lived properties retain random
request IDs, hashes and counters for two UK days. Repeated requests with the same
ID/data reuse their receipt. A pending/ambiguous write does not automatically
retry or claim success. The customer is asked to contact PrettyUs rather than
risk submitting another order. Requests with new IDs are distinct orders.

## Verification

Run `node --test tests/avon-orders.test.cjs` for non-live receiver checks. They use
only in-memory fixtures and never access Google. Browser fixtures should also
check nested Google iframe receipts, untrusted messages, error/unknown responses
and unchanged mobile layout with every network request intercepted.

Before any live test, obtain the owner's approval for one clearly labelled test
order. Verify its six values in the existing Sheet1. Keep the test row unless the
owner explicitly approves deleting it. A successful deployment or mock test alone
does not prove that a live order was saved.
