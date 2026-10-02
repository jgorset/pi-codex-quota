// Return rule names only. Never include matched text or file contents in errors.
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['openai-key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{30,}/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}/],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{30,}/],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/i],
  ['jwt-token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['credential-in-url', /https?:\/\/[^\s/"'<>:@]+:[^\s/"'<>@]+@/i],
];

export function sensitiveRules(content) {
  return rules.filter(([, pattern]) => pattern.test(content)).map(([name]) => name);
}

export function assertNoSensitiveContent(content, label) {
  const found = sensitiveRules(content);
  if (found.length) throw new Error(`Potential secret in ${label}; rules: ${found.join(', ')}. Values redacted.`);
}

export function isCredentialFilename(name) {
  return /^(?:\.env(?:\..*)?|\.npmrc|auth\.json|credentials(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|p12|pfx|key))$/i.test(name);
}
