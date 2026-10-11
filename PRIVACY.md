# SpecTest privacy policy

Last updated: 2026-10-10

SpecTest does not collect, store, sell or share personal data, and has no server of its own.

**Contract tests (the default).** The OpenAPI or Swagger document you load is read and turned into test code inside the extension's own page in your browser. Nothing is transmitted.

**Reading a page.** When you click "Use the contract on this page" or "Write tests for the selected code", the extension reads the current tab once: the contract text it finds there, or the text you selected. It cannot read any page unless you click its button on that page. The text is passed to the generator tab through `chrome.storage.session` and deleted as soon as that tab has read it.

**Loading by address.** When you type an address and press "Load", the extension requests that address without cookies. If the site blocks the request, the extension can ask Chrome, with your approval, for access to that one site.

**AI tests (optional, off until you use it).** If you enter your own API key and press "Generate tests", the extension sends the test plan built from your contract, or the code you pasted, together with your instructions, directly from your browser to the AI provider and address you entered. It is sent to no one else. That provider's own terms and privacy policy apply to what you send. The reply is displayed as text and is never run.

**What is stored.** Your last-used output language and check choices, and your AI provider, address and model name, in `chrome.storage.local` on this computer. Your API key is kept in memory only, unless you tick "Keep the key in this browser"; then it is stored unencrypted in the same local storage until you untick the box. Nothing is synced.

**What is not done.** No analytics, no tracking, no advertising, no remote code.

Contact: open an issue on the project's repository.
