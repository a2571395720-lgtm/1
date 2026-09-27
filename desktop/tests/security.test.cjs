const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { applicationUrl, uiAssetPath } = require('../security.cjs');
test('application browser rejects OS protocols, credentials and insecure remote origins', () => {
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'data:text/html,hello', 'https://user:password@example.com', 'http://jobs.example.com']) assert.throws(() => applicationUrl(url));
  assert.equal(applicationUrl('https://jobs.example.com/apply?id=4'), 'https://jobs.example.com/apply?id=4');
  assert.equal(applicationUrl('http://127.0.0.1:4567/'), 'http://127.0.0.1:4567/');
});
test('local protocol cannot read files outside UI or expose Node sources', () => {
  const root = path.resolve('desktop/ui');
  assert.equal(uiAssetPath('jobpilot://app/index.html', root), path.join(root, 'index.html'));
  for (const url of ['jobpilot://other/index.html', 'jobpilot://app/%2e%2e%2fmain.cjs', 'jobpilot://app/%5c..%5csecret.js', 'jobpilot://app/main.cjs', 'https://app/index.html']) assert.equal(uiAssetPath(url, root), null);
});
