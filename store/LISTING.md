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
SpecTest writes tests for you from code you copy, from a source file, or from an API contract.

Copy a function or a class from anywhere: your editor, a code review, a web page. Click the SpecTest button. It shows what you copied and which language it is in, and one click writes unit tests for it in the test framework that language normally uses. You can change the language, the framework, or add an instruction before it writes.

The unit tests are written by the AI model built into Chrome, on your own computer. There is no key to enter, no account, and your code is not sent anywhere. Chrome downloads the model once the first time; after that it works offline. The tests are a model's first draft: read them and run them before you keep them.

Give SpecTest an OpenAPI or Swagger contract instead, and it builds contract tests for a running API without any AI: for every operation, the documented success response and its required fields, missing and wrongly typed fields, values outside the allowed range, requests without credentials, and records that do not exist. You pick the operations and the checks, choose the language, and download one test file.

You can also upload a source file or a contract file, or open a contract on a web page and click the button there.

Limits
Chrome's built-in model needs Chrome 138 or newer on a computer with enough memory and disk; on other computers SpecTest says why and lets you use your own AI provider key instead. Contract tests call a real running service, so point them at a test environment.
```

## Privacy tab

**Single purpose**

```
Writes software tests: unit tests for source code the user copies or uploads, and API tests from an OpenAPI or Swagger contract the user provides.
```

**Permission justifications**

| Permission | Justification |
|---|---|
| `activeTab` | When the user clicks "Use the API contract on this page", reads the contract text from the current tab. No access exists without that click. |
| `clipboardRead` | When the user opens the SpecTest popup, it reads the clipboard once to show whether the user copied code or an API contract, so tests can be written in one click. The clipboard is not read at any other time and its content is not stored. |
| `scripting` | Runs the packaged function that reads that text from the current tab after the click. Only code shipped in the extension is injected. |
| `storage` | Passes the copied or page text to the SpecTest tab (session storage, deleted once read) and remembers the last-used output language and check choices on this device. Fallback AI provider settings are stored only if the user enters them; the key only if the user ticks a box asking for that. |
| Optional host permissions (`https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`) | Never granted at install. Requested for a single site, with a Chrome prompt, only when the user loads a contract from an address, or enters an AI provider address, that does not allow cross-origin reading. The broad pattern exists because those addresses are typed by the user and cannot be known in advance. |

**Remote code:** No, I am not using remote code.

**Data usage:** tick **Website content** (the extension reads contract text from the page the user clicks it on, and reads the clipboard when the popup opens). Tick nothing else. Unit tests are written by Chrome's on-device model, so no code is sent anywhere unless the user chooses the optional provider fallback. Certify all three statements.

**Privacy policy URL:** `https://github.com/udaykishore-resu/spectest/blob/main/PRIVACY.md`

## Distribution tab

Free · Public · All regions.

## Test instructions tab (optional, helps review)

```
No account and no key needed.
Unit tests: copy any function (for example a short JavaScript or Python function), click the SpecTest toolbar button, then "Write unit tests". Tests are written by Chrome's built-in model on the device (Chrome 138+; the first run downloads the model). On a computer that cannot run that model, use the contract flow below.
Contract tests: click the toolbar button, choose "Open SpecTest to paste or upload a file", then "Try a sample contract". Test code appears on the right; change the language with the buttons above it and press Download.
```

## Before you upload

- `npm run package` builds `dist/spectest-<version>.zip`; upload that file.
- `clipboardRead` shows users an install warning ("Read data you copy and paste"). That is the price of the one-click flow; the justification above explains it.
- The optional `https://*/*` permission may add time to the review. If it is rejected, the fallback is to drop "load by address" and the AI provider fallback and keep copy, paste, upload and page capture.
