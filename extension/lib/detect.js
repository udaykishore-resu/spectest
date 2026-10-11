/* SpecTest: works out what a piece of copied text is (an API contract, source code, or neither), which language the
   code is in, and which test framework and file name fit it. Pure functions; loads in the extension and in Node. */
(function (root) {
  'use strict';

  /* id, label, test framework the tests are written for, and how the test file is named from the code's main name. */
  const LANGS = [
    { id: 'go', label: 'Go', framework: 'the standard testing package', file: (n) => snake(n) + '_test.go' },
    { id: 'java', label: 'Java', framework: 'JUnit 5', file: (n) => pascal(n) + 'Test.java' },
    { id: 'kotlin', label: 'Kotlin', framework: 'JUnit 5 with kotlin.test', file: (n) => pascal(n) + 'Test.kt' },
    { id: 'scala', label: 'Scala', framework: 'ScalaTest (AnyFunSuite)', file: (n) => pascal(n) + 'Spec.scala' },
    { id: 'python', label: 'Python', framework: 'pytest', file: (n) => 'test_' + snake(n) + '.py' },
    { id: 'typescript', label: 'TypeScript', framework: 'Jest', file: (n) => camel(n) + '.test.ts' },
    { id: 'javascript', label: 'JavaScript', framework: 'Jest', file: (n) => camel(n) + '.test.js' },
    { id: 'csharp', label: 'C#', framework: 'xUnit', file: (n) => pascal(n) + 'Tests.cs' },
    { id: 'rust', label: 'Rust', framework: 'built-in #[test] functions in a #[cfg(test)] module', file: (n) => snake(n) + '_tests.rs' },
    { id: 'ruby', label: 'Ruby', framework: 'RSpec', file: (n) => snake(n) + '_spec.rb' },
    { id: 'php', label: 'PHP', framework: 'PHPUnit', file: (n) => pascal(n) + 'Test.php' },
    { id: 'swift', label: 'Swift', framework: 'XCTest', file: (n) => pascal(n) + 'Tests.swift' },
    { id: 'cpp', label: 'C++', framework: 'GoogleTest', file: (n) => snake(n) + '_test.cpp' },
    { id: 'c', label: 'C', framework: 'Unity (ThrowTheSwitch)', file: (n) => 'test_' + snake(n) + '.c' },
  ];

  /* Each rule adds its weight when its pattern is found. Weights favour things only one language writes. */
  const RULES = {
    go: [[/^\s*package\s+[a-z_][a-z0-9_]*\s*$/m, 5], [/^\s*func\s+(\([^)]*\)\s*)?[A-Za-z_]\w*\s*\(/m, 5], [/:=/, 2], [/^\s*import\s+\(\s*$/m, 4], [/\berr\s*!=\s*nil\b/, 5], [/\bfmt\.\w+\(/, 3], [/\bchan\b|\bgo\s+func\b|\bdefer\b/, 2]],
    java: [[/\bpublic\s+(final\s+|abstract\s+)?class\s+\w+/, 4], [/\b(public|private|protected)\s+(static\s+)?(final\s+)?[\w<>\[\], ]+\s+\w+\s*\([^)]*\)\s*(throws\s+[\w., ]+)?\s*\{/, 4], [/^\s*import\s+[\w.]+(\.\*)?;\s*$/m, 4], [/^\s*package\s+[\w.]+;\s*$/m, 5], [/\bSystem\.out\.print/, 4], [/@Override\b|@Autowired\b|@Service\b/, 3], [/\bnew\s+[A-Z]\w*(<[^>]*>)?\(/, 1]],
    kotlin: [[/^\s*fun\s+(<[^>]+>\s*)?[\w.]+\s*\(/m, 6], [/\b(val|var)\s+\w+\s*(:\s*[\w<>?, ]+)?\s*=/, 3], [/\bdata\s+class\b/, 5], [/^\s*package\s+[\w.]+\s*$/m, 2], [/\?\.|\?:|!!/, 2], [/\bwhen\s*\(/, 2], [/\bobject\s+\w+\s*\{/, 2]],
    scala: [[/^\s*(case\s+)?class\s+\w+(\[[^\]]+\])?\s*\(/m, 2], [/^\s*def\s+\w+(\[[^\]]+\])?\s*(\([^)]*\))?\s*:\s*[\w\[\]]+\s*=/m, 6], [/^\s*object\s+\w+/m, 3], [/\bcase\s+class\b/, 4], [/=>/, 1], [/^\s*import\s+[\w.]+\.(_|\{)/m, 4], [/\bimplicit\b|\btrait\b/, 3]],
    python: [[/^\s*def\s+\w+\s*\([^)]*\)\s*(->\s*[^:]+)?:\s*$/m, 6], [/^\s*class\s+\w+(\([^)]*\))?:\s*$/m, 5], [/^\s*(from\s+[\w.]+\s+)?import\s+[\w., ]+\s*$/m, 2], [/\bself\b/, 2], [/\bNone\b|\bTrue\b|\bFalse\b/, 1], [/^\s*@\w+/m, 1], [/\belif\b/, 3], [/f"[^"]*\{/, 2]],
    typescript: [[/:\s*(string|number|boolean|void|unknown|any|never)\b/, 4], [/\binterface\s+\w+\s*(extends\s+[\w, ]+)?\{/, 4], [/\btype\s+\w+\s*=/, 3], [/\bexport\s+(default\s+)?(async\s+)?function\b|\bexport\s+const\b/, 2], [/\bimport\s+.+\s+from\s+['"]/, 2], [/<\w+>\(|\bas\s+(const|\w+)\b/, 1], [/\b(public|private|readonly)\s+\w+\s*:/, 2]],
    javascript: [[/\bfunction\s+\w+\s*\(/, 3], [/\b(const|let|var)\s+\w+\s*=\s*(async\s*)?(\([^)]*\)|\w+)\s*=>/, 4], [/\bmodule\.exports\b|\brequire\(\s*['"]/, 5], [/\bexport\s+(default\s+)?(async\s+)?function\b|\bexport\s+const\b/, 2], [/\bimport\s+.+\s+from\s+['"]/, 2], [/===|!==/, 2], [/\bconsole\.log\(/, 2]],
    csharp: [[/^\s*using\s+[\w.]+;\s*$/m, 4], [/^\s*namespace\s+[\w.]+/m, 5], [/\bpublic\s+(static\s+|async\s+|override\s+|virtual\s+)*[\w<>\[\],?]+\s+[A-Z]\w*\s*\(/, 3], [/\{\s*get;\s*(set;)?\s*\}/, 6], [/\bvar\s+\w+\s*=\s*new\b/, 2], [/\bstring\[\]|\bList<\w+>|\bTask<\w*>/, 2], [/Console\.Write/, 4]],
    rust: [[/^\s*(pub\s+)?fn\s+\w+(<[^>]*>)?\s*\(/m, 5], [/\blet\s+mut\b/, 5], [/->\s*(Result|Option|Self|Vec|&?str|String|u\d+|i\d+|bool)\b/, 4], [/^\s*use\s+[\w:]+(::\{[^}]*\})?;\s*$/m, 3], [/\bimpl\b/, 3], [/&self|&mut\s/, 4], [/println!|vec!|format!/, 4]],
    ruby: [[/^\s*def\s+\w+[?!=]?(\(.*\))?\s*$/m, 4], [/^\s*end\s*$/m, 3], [/^\s*class\s+\w+(\s*<\s*[\w:]+)?\s*$/m, 3], [/\bputs\b|\battr_(reader|accessor|writer)\b/, 4], [/^\s*require(_relative)?\s+['"]/m, 4], [/\bdo\s*\|[^|]*\|/, 4], [/@\w+\s*=/, 1]],
    php: [[/<\?php/, 10], [/\$\w+\s*=/, 3], [/\bfunction\s+\w+\s*\(/, 1], [/->\w+\(/, 1], [/\bpublic\s+function\b/, 4], [/^\s*namespace\s+[\w\\]+;/m, 4], [/\becho\b/, 2]],
    swift: [[/^\s*(public\s+|private\s+)?func\s+\w+\s*(<[^>]*>)?\s*\(/m, 4], [/\bguard\s+let\b|\bif\s+let\b/, 6], [/^\s*import\s+(Foundation|UIKit|SwiftUI)\s*$/m, 8], [/\bstruct\s+\w+\s*:\s*\w+/, 2], [/\bvar\s+\w+\s*:\s*[\w?]+/, 2], [/->\s*[A-Z]\w*\??\s*\{/, 2]],
    cpp: [[/^\s*#include\s*<(iostream|vector|string|map|memory|algorithm)>/m, 6], [/\bstd::/, 5], [/\bnamespace\s+\w+\s*\{/, 2], [/\btemplate\s*</, 4], [/\b(class|struct)\s+\w+\s*(:\s*(public|private)\s+\w+)?\s*\{/, 1], [/::\w+\s*\(/, 2], [/\bauto\s+\w+\s*=/, 2]],
    c: [[/^\s*#include\s*<(stdio|stdlib|string|stdint|stdbool)\.h>/m, 6], [/\bprintf\s*\(|\bmalloc\s*\(|\bfree\s*\(/, 3], [/^\s*(static\s+)?(int|void|char|double|float|long|unsigned|size_t|bool)\s*\*?\s*\w+\s*\([^)]*\)\s*\{/m, 3], [/\bstruct\s+\w+\s*\*/, 2], [/->\w+/, 1]],
  };

  const byId = (id) => LANGS.find((l) => l.id === id) || null;

  function snake(n) {
    return String(n).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'code';
  }
  function pascal(n) {
    const s = String(n).replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[a-z]/, (c) => c.toUpperCase());
    return /^[A-Za-z]/.test(s) ? s : 'Code';
  }
  function camel(n) {
    const p = pascal(n);
    return p.charAt(0).toLowerCase() + p.slice(1);
  }

  /* Is this an OpenAPI or Swagger document? Looks only at the top of the text so it stays cheap on large inputs. */
  function isContract(text) {
    const head = String(text || '').slice(0, 20000);
    return /(^|\n|\{|,)\s*["']?(openapi|swagger)["']?\s*:\s*["']?\d/.test(head) && /(^|\n|,|\{)\s*["']?paths["']?\s*:/.test(String(text));
  }

  /* Rough signals that text is source code rather than prose: symbols, keywords and indentation. */
  function looksLikeCode(text) {
    const t = String(text || '').trim();
    if (t.length < 12 || t.length > 400000) return false;
    const lines = t.split(/\r?\n/);
    const symbols = (t.match(/[{}();=<>\[\]]/g) || []).length / t.length;
    const indented = lines.filter((l) => /^(\t| {2,})\S/.test(l)).length / lines.length;
    const keyword = /\b(function|func|def|class|return|import|package|public|private|const|let|var|fn|struct|interface|if|for|while)\b/.test(t);
    const sentences = (t.match(/[a-z]{3,}[.!?](\s|$)/g) || []).length / Math.max(1, lines.length);
    if (!keyword) return false;
    return symbols > 0.02 || indented > 0.2 || (lines.length > 1 && sentences < 0.5);
  }

  /* Returns { id, label, confidence: 'high' | 'low' } or null. TypeScript beats JavaScript only on type syntax. */
  function detectLanguage(text) {
    const t = String(text || '');
    if (!t.trim()) return null;
    const scores = {};
    for (const id of Object.keys(RULES)) {
      let s = 0;
      for (const [re, w] of RULES[id]) if (re.test(t)) s += w;
      scores[id] = s;
    }
    // Shared syntax: JavaScript code is valid TypeScript, so TypeScript needs its own evidence on top.
    if (scores.typescript > 0) scores.typescript += Math.min(scores.javascript, 4);
    if (scores.typescript <= 4) scores.typescript = 0;
    if (scores.cpp > 0 && scores.c > 0 && /\bstd::|\bclass\s|\btemplate\s*</.test(t)) scores.c = 0;
    const ranked = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
    const best = ranked[0];
    if (!scores[best] || scores[best] < 4) return null;
    const second = scores[ranked[1]] || 0;
    const lang = byId(best);
    return { id: lang.id, label: lang.label, confidence: scores[best] >= 8 && scores[best] - second >= 3 ? 'high' : 'low' };
  }

  /* The name the test file is called after: the first class or function the code declares. Interfaces, data
     classes, enums and type aliases are skipped: they are rarely what the tests are about. */
  function mainName(text) {
    const t = String(text || '');
    const res = [
      /^[ \t]*(?:export\s+)?(?:public\s+|private\s+|internal\s+|final\s+|abstract\s+|sealed\s+|open\s+|static\s+)*(?:class|struct|object|trait)\s+([A-Za-z_]\w*)/gm,
      /^[ \t]*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm,
      /^[ \t]*(?:export\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:function|def|fun|fn)\s+(?:<[^>]+>\s*)?([A-Za-z_][\w.]*)/gm,
      /^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/gm,
      /^[ \t]*(?:static\s+|inline\s+)*(?:unsigned\s+|const\s+)?[A-Za-z_][\w:<>]*\s*\*?\s+\*?([A-Za-z_]\w*)\s*\([^;{]*\)\s*\{/gm,
    ];
    let best = null;
    for (const re of res) {
      for (const m of t.matchAll(re)) {
        const name = m[1].split('.').pop();
        if (['main', 'if', 'for', 'while', 'switch', 'return', 'init', '__init__'].includes(name)) continue;
        if (!best || m.index < best.index) best = { index: m.index, name };
        break;
      }
    }
    return best ? best.name : 'code';
  }

  /* Language from a file name, for uploaded files. More reliable than reading the text. */
  const EXT = { go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', sc: 'scala', py: 'python', ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', cs: 'csharp', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', c: 'c', h: 'c' };
  function languageFromFileName(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
    const id = m && EXT[m[1].toLowerCase()];
    return id ? { id, label: byId(id).label, confidence: 'high' } : null;
  }

  function testFileName(langId, text) {
    const lang = byId(langId);
    return lang ? lang.file(mainName(text)) : 'generated_test.txt';
  }

  /* One call for the popup and the generator: what is this text, and how should it be handled? */
  function classify(text, fileName) {
    const t = String(text || '');
    if (!t.trim()) return { kind: 'empty' };
    if (isContract(t)) return { kind: 'contract' };
    const language = languageFromFileName(fileName) || detectLanguage(t);
    if (language || looksLikeCode(t)) return { kind: 'code', language, lines: t.trim().split(/\r?\n/).length };
    return { kind: 'text' };
  }

  const api = { LANGS, byId, isContract, looksLikeCode, detectLanguage, languageFromFileName, mainName, testFileName, classify };
  root.SpecTestDetect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
