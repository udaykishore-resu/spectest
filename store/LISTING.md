# Chrome Web Store listing: SpecTest

Everything to paste into the developer dashboard. URLs assume the repo is `github.com/udaykishore-resu/spectest`; change them if you name it differently.

## Store listing tab

| Field | Value |
|---|---|
| Category | Developer Tools |
| Language | English |
| Store icon | `spectest-store-icon-128.png` |
| Screenshots | `spectest-screenshot-1.png`, `spectest-screenshot-2.png` |
| Small promo tile | `spectest-promo-440x280.png` |
| Marquee promo tile | leave empty |
| Global promo video | leave empty |
| Official URL | None |
| Homepage URL | `https://github.com/udaykishore-resu/spectest` |
| Support URL | `https://github.com/udaykishore-resu/spectest/issues` |
| Mature content | No |

### Description

```
SpecTest turns the contract of an HTTP API into tests you can run.

Open an OpenAPI or Swagger document, or click the toolbar button on a page that shows one. SpecTest reads every operation and writes one test for each rule the contract states: the documented success response and its required fields, a missing required field, a wrong type, a value outside the allowed range, a request without credentials, and a record that does not exist.

You choose which operations and which checks to include, pick the language your project uses, and download a single test file. The file has no dependencies beyond the usual test tooling of that language and reads the address of the API and the access token from environment variables. Tests that need a token are skipped, not failed, when none is set.

Where the contract documents the error status, the test expects exactly that status. Where it documents none, the expectation is marked as an assumption in the generated code, so you can see which tests rest on the contract and which on convention.

Everything above happens inside your browser. The contract is not uploaded anywhere.

An optional second mode uses an AI provider with your own API key to write the same test plan in other languages, or to write unit tests for code you select or paste. It is off until you enter a key. What you send goes directly from your browser to the provider you chose, and the answer is shown as text and never run.

Limits
The tests call a running service, so point them at a test environment: they create, change and delete records. Success tests use the example values from the contract and may need your own test data. Contracts split across several files, and file-upload or XML request bodies, are not supported.
```

## Privacy tab

**Single purpose**

```
Generates API test code from an OpenAPI or Swagger document that the user opens, pastes or points the extension at.
```

**Permission justifications**

| Permission | Justification |
|---|---|
| `activeTab` | When the user clicks "Use the contract on this page" or "Write tests for the selected code", reads the contract text or the selected text from the current tab. No access exists without that click. |
| `scripting` | Runs the packaged function that reads that text from the current tab after the click. Only code shipped in the extension is injected. |
| `storage` | Passes the text read from the tab to the generator page (session storage, deleted once read) and remembers the last-used language, check choices and AI provider settings on this device. The API key is stored only if the user ticks a box asking for that. |
| Optional host permissions (`https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`) | Never granted at install. Requested for a single site, with a Chrome prompt, only when the user loads a contract from an address, or enters an AI provider address, that does not allow cross-origin reading. The broad pattern exists because those addresses are typed by the user and cannot be known in advance. |

**Remote code:** No, I am not using remote code.

**Data usage:** tick **Website content** (the extension reads contract text or selected text from the page the user clicks it on, and in the optional AI mode sends the user's chosen text to the AI provider the user configured). Tick nothing else. Certify all three statements.

**Privacy policy URL:** `https://github.com/udaykishore-resu/spectest/blob/main/PRIVACY.md`

## Distribution tab

Free · Public · All regions.

## Test instructions tab (optional, helps review)

```
No account needed. Click the SpecTest toolbar button, choose "Open the generator", then "Try the sample contract". Test code appears on the right; change the language with the buttons above it and press Download. The "AI tests" tab does nothing until an API key is entered and is not needed to review the extension.
```

## Before you upload

- `npm run package` builds `dist/spectest-<version>.zip`; upload that file.
- The optional `https://*/*` permission may add time to the review. If it is rejected, the fallback is to drop "load by address" and custom AI addresses and keep paste, file and page capture.
