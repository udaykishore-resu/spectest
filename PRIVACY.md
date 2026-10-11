# SpecTest privacy policy

Last updated: 2026-10-11

SpecTest does not collect, store, sell or share personal data, and has no server of its own.

**Unit tests from code.** When you open the SpecTest popup, it reads your clipboard once to show whether you copied code or an API contract. The clipboard is not read at any other time, and its content is not kept. When you click "Write unit tests", the code is passed to the SpecTest tab and the tests are written by Chrome's built-in model on your computer. The code is not transmitted.

**Contract tests.** The OpenAPI or Swagger document you load is read and turned into test code inside the extension's own page in your browser. Nothing is transmitted.

**Reading a page.** When you click "Use the API contract on this page", the extension reads the current tab once for the contract text it finds there. It cannot read any page unless you click its button on that page. The text is passed to the generator tab through `chrome.storage.session` and deleted as soon as that tab has read it.

**Loading by address.** When you type an address and press "Load", the extension requests that address without cookies. If the site blocks the request, the extension can ask Chrome, with your approval, for access to that one site.

**AI provider fallback (only if you choose it).** It is offered only on a computer where Chrome cannot run its built-in model. If you enter your own API key and choose to use it, the extension sends the code and your instructions directly from your browser to the AI provider and address you entered. It is sent to no one else. That provider's own terms and privacy policy apply to what you send. The reply is displayed as text and is never run.

**What is stored.** Your last-used output language and check choices, and your AI provider, address and model name, in `chrome.storage.local` on this computer. Your API key is kept in memory only, unless you tick "Keep the key in this browser"; then it is stored unencrypted in the same local storage until you untick the box. Nothing is synced.

**What is not done.** No analytics, no tracking, no advertising, no remote code.

Contact: open an issue on the project's repository.
