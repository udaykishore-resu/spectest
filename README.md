# SpecTest

A Chrome extension that writes tests from three kinds of input: **code you copied**, **an API contract**, or **a source file you upload**. Copy a function or class anywhere, click the SpecTest button, and unit tests in that language appear, written by Chrome's built-in model on your own computer: no API key, no account, and the code is not sent anywhere. Give it an OpenAPI or Swagger document instead and it builds contract tests for a running API in Go, Java, Python, JavaScript or curl, checked against the contract's own rules.

**Topics:** `chrome-extension` `manifest-v3` `unit-testing` `test-generation` `chrome-built-in-ai` `gemini-nano` `openapi` `swagger` `api-testing` `contract-testing` `developer-tools`

## The three ways in

| You give it | What happens | What writes the tests |
|---|---|---|
| Copied code | Click the toolbar button (or press Alt+Shift+T). The popup shows what you copied, recognised by language. One click opens SpecTest with the tests being written. | Chrome's built-in model, on your computer |
| An API contract | Copy it, upload it, open it on GitHub and click "Use the API contract on this page", or load it from an address | SpecTest's own rules, no model involved |
| A source file | "Upload a file" or drop it on the box; the file name decides the language | As above, depending on what the file is |

Languages recognised for unit tests, with the framework used by default (you can change both before writing):

| Language | Framework | Test file |
|---|---|---|
| Go | standard `testing` | `discount_test.go` |
| Java | JUnit 5 | `PriceCalculatorTest.java` |
| Kotlin | JUnit 5 + kotlin.test | `DiscountTest.kt` |
| Scala | ScalaTest | `PricingSpec.scala` |
| Python | pytest | `test_discount.py` |
| TypeScript / JavaScript | Jest | `total.test.ts` / `total.test.js` |
| C# | xUnit | `PriceCalculatorTests.cs` |
| Rust | `#[test]` | `discount_tests.rs` |
| Ruby | RSpec | `price_calculator_spec.rb` |
| PHP | PHPUnit | `PriceCalculatorTest.php` |
| Swift | XCTest | `PriceCalculatorTests.swift` |
| C++ | GoogleTest | `discount_test.cpp` |
| C | Unity | `test_discount.c` |

### About Chrome's built-in model

Unit tests are written by Gemini Nano through Chrome's Prompt API, which extensions can use from Chrome 138. Chrome downloads the model once (a few GB) the first time; SpecTest shows the progress. Chrome only runs it on computers with Windows 10/11, macOS 13+, Linux or a Chromebook Plus, at least 22 GB of free disk, and either more than 4 GB of GPU memory or 16 GB of RAM. On a computer that cannot run it, SpecTest says why and only then offers to use an AI provider key instead.

**Speed.** The model writes a few dozen words a second on a typical laptop, so the time is mostly the length of the test file it writes: a long, thorough file for a 250-line class can take a minute or more. SpecTest takes everything else off the clock: the model is loaded once per tab, not once per request; the code is read into the model in the background while you look at it, so pressing **Write tests** only sends the short instruction; the same code and settings a second time are answered at once; and **Quick** (one normal and one error case per function) asks for a much shorter file. After each run the page shows the total time and when the first line appeared.

It is a small model. Expect a useful first draft that sometimes calls functions the wrong way or misses an edge case, not finished tests. Copy one function or class at a time: about 12,000 characters of code is the most it is given.

## Contract tests: what they check

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
| `extension/lib/detect.js` | Tells code from contracts from prose, recognises 14 languages, picks framework and test file name |
| `extension/lib/ondevice.js` | Chrome's built-in model: availability, one-time download, streamed answer |
| `extension/lib/ai.js` | The unit-test prompt, and the AI-provider fallback for computers that cannot run the built-in model |
| `extension/lib/js-yaml.min.js` | js-yaml 4.1.0 (MIT, licence alongside), the only third-party code |
| `test/` | Unit tests (`node --test`), code samples in 14 languages, the sample contract, a mock API, and `verify-languages.js` |
| `e2e/` | Browser tests in real Chromium with the extension loaded |
| `store/` | Chrome Web Store listing text, screenshots, promo tile and icon, with the scripts that make them |
| `scripts/package.sh` | Builds `dist/spectest-<version>.zip` |

## Try it

1. `chrome://extensions` → switch on **Developer mode** → **Load unpacked** → choose the `extension/` folder.
2. **Unit tests:** copy any function (the sample in `test/fixtures/code/` works), click the SpecTest toolbar button → **Write unit tests**.
3. **Contract tests:** click the button → **Open SpecTest to paste or upload a file** → **Try a sample contract** → pick a language → **Download**.
4. To see the contract tests pass, start the bundled mock API and run the file against it:

```bash
PORT=8080 node test/fixtures/mock-server.js &
API_BASE_URL=http://127.0.0.1:8080 API_TOKEN=test-token node --test api-contract.test.mjs
```

On a page that shows a contract (a file on GitHub, a raw JSON or YAML URL, or API documentation that links to its contract), **Use the API contract on this page** loads it directly.

## How it works

Opening the popup reads the clipboard once (the `clipboardRead` permission), recognises what is there, and shows it. Nothing is read in the background and nothing is kept: on "Write tests" the text is handed to the SpecTest tab through session storage and removed as soon as that tab reads it.

Unit tests are written in the SpecTest tab by Chrome's built-in model through the Prompt API (`LanguageModel`). The code stays on the computer. The answer streams in as text and is never run.

For a contract on a web page, the popup asks the service worker to read the current tab. That uses `activeTab`, so the extension can only read a page at the moment you click its button, and has no standing access to any site. The text is handed to the generator page through session storage and removed as soon as it is read. Everything in contract mode happens inside that page: parsing, planning and writing the code. Nothing is sent anywhere.

Loading a contract by address uses an ordinary request. If the site does not allow other pages to read it, SpecTest shows an **Allow access** button that asks Chrome for permission to that one site.

Only when Chrome says this computer cannot run its model does SpecTest show the provider fallback. If you then choose it, the code goes from the SpecTest tab straight to that provider with the key you typed. The key stays in memory unless you tick the box to keep it.

## Develop

```bash
npm test                 # 39 unit tests
npm run verify           # generated tests really run, in every language (needs go, python3 + pytest + requests, javac, curl)
NODE_PATH=$(npm root -g) npm run e2e   # 63 browser checks; needs Playwright with Chromium
npm run screenshots      # regenerate the store pictures
npm run package          # dist/spectest-<version>.zip
```

`npm run verify` generates tests from `test/fixtures/shop.yaml` in each language and runs them three ways: against a mock API that follows the contract (all 33 must pass), against one that breaks it (the guarding tests must fail), and without a token (credentialed tests must skip). It then sends deliberately awkward text (quotes, backslashes, `$`, backticks, newlines, non-ASCII, emoji) from every language to a recording server and compares what arrived byte for byte.

## Limits

- **Unit tests are a model's first draft.** Chrome's built-in model is small. Its tests are not run or checked by SpecTest and need reading and fixing before you keep them.
- **The built-in model needs a capable computer** (see above) and Chrome 138+. Elsewhere there is no key-free way to write unit tests; the provider fallback needs your own key.
- **Unit tests see only the code you give them.** Code that calls other files' functions gets tests that assume what those functions do.
- **Contract tests: HTTP APIs with an OpenAPI 3.x or Swagger 2.0 document only.** Not GraphQL, gRPC, SOAP or AsyncAPI. They check a running service from outside.
- **The tests change data.** POST, PUT and DELETE tests really create, replace and delete. Point them at a test environment.
- **Success-path tests need matching test data.** Path values come from the contract's examples (or `1` / `string`); if record `1` does not exist, that test fails until you edit the value.
- **No chaining.** A test does not create a record and then fetch it.
- **Not handled:** `$ref` to other files, multipart and XML bodies (the test sends no body and a note says so), `pattern` when building sample strings, more than one credential on the same request. For `oneOf`/`anyOf` request bodies the first branch is used; responses with several allowed shapes get a status check only.
- **OAuth:** the tests send whatever token you put in `API_TOKEN`; they do not obtain one.
- **What has not been tested:** the built-in model itself. Chrome's model is not available in the browser these tests run in, so the browser tests replace it with a stand-in that has the documented Prompt API shape; the quality of real Gemini Nano tests is unknown until you try it. The provider fallback has only been run against a stand-in server. The Java output is compiled and run in this repo's check with a stand-in for the three JUnit classes it uses, not with the JUnit jar. The toolbar click itself cannot be automated; the browser tests call the same function the click calls.

## Privacy

See [PRIVACY.md](PRIVACY.md). Unit tests with the built-in model and contract tests send nothing anywhere. The provider fallback, if you choose it, sends the code only to the provider you set.

## Skills demonstrated

- **API contract modelling:** one internal model for OpenAPI 3.0, 3.1 and Swagger 2.0, with `$ref`, `allOf`, `oneOf`, recursive schemas and security schemes
- **On-device AI in a browser extension:** Chrome's Prompt API with availability checks, a one-time model download with progress, streaming, cancellation and a context-size guard
- **Language detection without a parser:** weighted signals that tell 14 languages apart, tested on a sample of each
- **Test design:** deriving positive and negative cases from a schema, and separating documented expectations from assumed ones
- **Multi-language code generation:** Go, Java, Python, JavaScript and shell emitters from one neutral plan, with string quoting verified byte for byte in each
- **Verification discipline:** generated code is executed against a correct and a deliberately broken service, and compiled for about 80 public contracts (Stripe, Box, Slack, Discord, Twilio)
- **Chrome Manifest V3:** service worker, `activeTab` + `scripting` on demand, optional host permissions requested per site, session storage hand-off, no remote code
- **Security-minded front end:** DOM built without HTML strings, user keys kept out of storage by default, model output treated as text
- **Browser automation:** Playwright driving real Chromium with the unpacked extension

## Licence

MIT. See [LICENSE](LICENSE). js-yaml is MIT; its licence is in `extension/lib/js-yaml.LICENSE`.
