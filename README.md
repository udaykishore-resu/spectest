# SpecTest

A Chrome extension that turns an OpenAPI or Swagger document into API contract tests you can run. Open a contract (on GitHub, as a raw file, from a documentation page, pasted, or from disk), choose what to check, and download one test file in Go, Java, Python, JavaScript or as a curl script. Every test sends a real request to a running API and checks the status code and the response fields the contract promises. An optional AI mode, with your own API key, writes the same test plan in other languages or writes unit tests for code you paste.

**Topics:** `chrome-extension` `manifest-v3` `openapi` `swagger` `api-testing` `contract-testing` `test-generation` `golang` `pytest` `junit5` `developer-tools`

## What it generates

For each operation in the contract, up to six kinds of test:

| Check | The test sends | The test expects |
|---|---|---|
| Documented success response | A valid request built from the contract's examples, defaults and limits | A documented 2xx status, and each required response field present with its JSON type |
| Missing required field or parameter | The valid request without one required body field (first two fields) or query parameter | 400 or 422 |
| Wrong type in the body | One body field as the wrong JSON type | 400 or 422 |
| Value outside enum or limits | One value that breaks an `enum`, `minimum`, `maximum`, `minLength` or `maxLength` | 400 or 422 |
| No credentials | The valid request without the credential | 401 or 403 |
| Record that does not exist | An identifier that should not exist | 404, only where the contract documents it |

When the contract documents the error status, the test expects exactly that. When it documents none, the expectation is an assumption and the generated code says so in a comment on that test.

The generated file has no dependencies beyond the language's usual test tooling:

| Target | File | Needs |
|---|---|---|
| Go | `api_contract_test.go` | Go 1.18+, standard library only |
| Java | `ApiContractTest.java` | Java 11+, JUnit 5; a small JSON reader is included in the file |
| Python | `test_api_contract.py` | pytest and requests |
| JavaScript | `api-contract.test.mjs` | Node.js 20+, no packages |
| Shell | `api-contract.sh` | bash and curl; status codes only |
| Test plan | `api-contract-plan.json` | The same cases as data |

All of them read `API_BASE_URL` and `API_TOKEN` (or `API_TOKEN_<SCHEME>` per security scheme) at run time, and skip, rather than fail, tests that need a credential when none is set.

## Repo layout

| Path | What it holds |
|---|---|
| `extension/` | The extension itself. This folder is what you load unpacked and what gets zipped for the store. |
| `extension/lib/spec.js` | Reads OpenAPI 3.x / Swagger 2.0 (JSON or YAML) into one model; builds sample values from schemas |
| `extension/lib/plan.js` | Turns the model into a language-neutral list of test cases |
| `extension/lib/emit.js` | Writes the cases out as Go, Java, Python, JavaScript, curl or JSON |
| `extension/lib/ai.js` | The optional AI mode: prompt, request and reply handling |
| `extension/lib/js-yaml.min.js` | js-yaml 4.1.0 (MIT, licence alongside), the only third-party code |
| `test/` | Unit tests (`node --test`), the sample contract, a mock API, and `verify-languages.js` |
| `e2e/` | Browser tests in real Chromium with the extension loaded |
| `store/` | Chrome Web Store listing text, screenshots, promo tile and icon, with the scripts that make them |
| `scripts/package.sh` | Builds `dist/spectest-<version>.zip` |

## Try it

1. `chrome://extensions` → switch on **Developer mode** → **Load unpacked** → choose the `extension/` folder.
2. Click the SpecTest toolbar button → **Open the generator** → **Try the sample contract**.
3. Pick a language and press **Download**.
4. To see the tests pass, start the bundled mock API and run the file against it:

```bash
PORT=8080 node test/fixtures/mock-server.js &
API_BASE_URL=http://127.0.0.1:8080 API_TOKEN=test-token node --test api-contract.test.mjs
```

On a page that shows a contract (a file on GitHub, a raw JSON or YAML URL, or API documentation that links to its contract), **Use the contract on this page** loads it directly.

## How it works

The popup asks the service worker to read the current tab. That uses `activeTab`, so the extension can only read a page at the moment you click its button, and has no standing access to any site. The text is handed to the generator page through session storage and removed as soon as it is read. Everything in contract mode happens inside that page: parsing, planning and writing the code. Nothing is sent anywhere.

Loading a contract by address uses an ordinary request. If the site does not allow other pages to read it, SpecTest shows an **Allow access** button that asks Chrome for permission to that one site.

AI mode sends the test plan (or the code you pasted) from the generator page straight to the provider you configured, with the key you typed. The key stays in memory unless you tick the box to keep it. The answer is shown as text and is never executed.

## Develop

```bash
npm test                 # 24 unit tests
npm run verify           # generated tests really run, in every language (needs go, python3 + pytest + requests, javac, curl)
NODE_PATH=$(npm root -g) npm run e2e   # 51 browser checks; needs Playwright with Chromium
npm run screenshots      # regenerate the store pictures
npm run package          # dist/spectest-<version>.zip
```

`npm run verify` generates tests from `test/fixtures/shop.yaml` in each language and runs them three ways: against a mock API that follows the contract (all 33 must pass), against one that breaks it (the guarding tests must fail), and without a token (credentialed tests must skip). It then sends deliberately awkward text (quotes, backslashes, `$`, backticks, newlines, non-ASCII, emoji) from every language to a recording server and compares what arrived byte for byte.

## Limits

- **HTTP APIs with an OpenAPI 3.x or Swagger 2.0 document only.** Not GraphQL, gRPC, SOAP or AsyncAPI.
- **"Any language" is true only through AI mode.** The checked templates are the five above plus the JSON plan. AI output is written by a model and is not run or checked by SpecTest.
- **These are contract tests, not unit tests.** They check a running service from outside. Unit tests of your own functions are only available through AI mode.
- **The tests change data.** POST, PUT and DELETE tests really create, replace and delete. Point them at a test environment.
- **Success-path tests need matching test data.** Path values come from the contract's examples (or `1` / `string`); if record `1` does not exist, that test fails until you edit the value.
- **No chaining.** A test does not create a record and then fetch it.
- **Not handled:** `$ref` to other files, multipart and XML bodies (the test sends no body and a note says so), `pattern` when building sample strings, more than one credential on the same request. For `oneOf`/`anyOf` request bodies the first branch is used; responses with several allowed shapes get a status check only.
- **OAuth:** the tests send whatever token you put in `API_TOKEN`; they do not obtain one.
- **What has not been tested:** AI mode has only been run against a stand-in server, never against a real provider. The Java output is compiled and run in this repo's check with a stand-in for the three JUnit classes it uses, not with the JUnit jar. The toolbar click itself cannot be automated; the browser tests call the same function the click calls.

## Privacy

See [PRIVACY.md](PRIVACY.md). Contract mode sends nothing. AI mode sends only what you choose, only to the provider you choose.

## Skills demonstrated

- **API contract modelling:** one internal model for OpenAPI 3.0, 3.1 and Swagger 2.0, with `$ref`, `allOf`, `oneOf`, recursive schemas and security schemes
- **Test design:** deriving positive and negative cases from a schema, and separating documented expectations from assumed ones
- **Multi-language code generation:** Go, Java, Python, JavaScript and shell emitters from one neutral plan, with string quoting verified byte for byte in each
- **Verification discipline:** generated code is executed against a correct and a deliberately broken service, and compiled for about 80 public contracts (Stripe, Box, Slack, Discord, Twilio)
- **Chrome Manifest V3:** service worker, `activeTab` + `scripting` on demand, optional host permissions requested per site, session storage hand-off, no remote code
- **Security-minded front end:** DOM built without HTML strings, user keys kept out of storage by default, model output treated as text
- **Browser automation:** Playwright driving real Chromium with the unpacked extension

## Licence

MIT. See [LICENSE](LICENSE). js-yaml is MIT; its licence is in `extension/lib/js-yaml.LICENSE`.
