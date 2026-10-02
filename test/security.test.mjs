import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { assertNoSensitiveContent, isCredentialFilename, sensitiveRules } from '../scripts/security-patterns.mjs';

// Construct fake examples at runtime so no token-like literal is checked in.
const examples = [
  ['private-key', '-----BEGIN ' + 'PRIVATE KEY-----'],
  ['openai-key', 'sk-' + 'a'.repeat(30)],
  ['github-token', 'ghp_' + 'a'.repeat(36)],
  ['github-token', 'github_pat_' + 'a'.repeat(40)],
  ['aws-access-key', 'AKIA' + 'A'.repeat(16)],
  ['npm-token', 'npm_' + 'a'.repeat(36)],
  ['slack-token', 'xoxb-' + 'a'.repeat(30)],
  ['google-api-key', 'AIza' + 'a'.repeat(35)],
  ['bearer-token', 'Bearer ' + 'a'.repeat(30)],
  ['jwt-token', 'eyJ' + 'a'.repeat(20) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(20)],
  ['credential-in-url', 'https://' + 'example-user:example-password@invalid.test'],
];

test('common credential families are detected without returning matched values', () => {
  for (const [rule, value] of examples) {
    assert.ok(sensitiveRules(value).includes(rule));
    assert.ok(!JSON.stringify(sensitiveRules(value)).includes(value));
  }
});

test('secret check failures cannot leak the input through Error or assertion metadata', () => {
  for (const [rule, value] of examples) {
    const input = `sensitive document\n${value}\nend of document`;
    assert.throws(() => assertNoSensitiveContent(input, 'fixture.txt'), error => {
      assert.match(error.message, /Values redacted/);
      assert.ok(error.message.includes(rule));
      assert.ok(!inspect(error, { depth: null }).includes(value));
      assert.ok(!inspect(error, { depth: null }).includes(input));
      assert.equal(Object.hasOwn(error, 'actual'), false);
      return true;
    });
  }
});

test('clearly synthetic fixtures and ordinary text pass the guard', () => {
  const content = 'SYNTHETIC_ACCESS_TOKEN, SYNTHETIC_ACCOUNT_ID, Weekly: 20% / 3d 12h left';
  assert.deepEqual(sensitiveRules(content), []);
  assert.doesNotThrow(() => assertNoSensitiveContent(content, 'fixture.json'));
});

test('credential/config filenames are rejected before their contents are read', () => {
  for (const name of ['.env', '.env.local', '.npmrc', 'auth.json', 'credentials.json', 'id_rsa', 'id_ed25519', 'secret.pem', 'secret.p12', 'secret.pfx']) {
    assert.equal(isCredentialFilename(name), true);
  }
  for (const name of ['package.json', 'package-lock.json', 'quota.json', 'security-patterns.mjs', 'README.md']) {
    assert.equal(isCredentialFilename(name), false);
  }
});
