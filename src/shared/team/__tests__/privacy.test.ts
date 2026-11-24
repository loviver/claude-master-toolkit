import { describe, it, expect } from 'vitest';
import { redactHome, scanFields } from '../privacy.js';

// Fake secrets are assembled at runtime so repository secret scanners do not flag this file.
const j = (...p: string[]) => p.join('');

describe('team/privacy', () => {
  it.each([
    ['private-key', j('-----BEGIN RSA ', 'PRIVATE KEY-----')],
    ['github-token', j('ghp_', 'a'.repeat(36))],
    ['github-token', j('github_pat_', 'A1'.repeat(20))],
    ['aws-access-key', j('AKIA', 'ABCDEFGHIJKLMNOP')],
    ['slack-token', j('xoxb-', '1234567890-abcdefghij')],
    ['clickup-token', j('pk_', '12345678_', 'A'.repeat(32))],
    ['api-secret-key', j('sk-', 'ant-', 'a1B2'.repeat(10))],
    ['jwt', j('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0NTYifQ', '.c2lnbmF0dXJlLXZhbHVl')],
    ['url-credentials', j('postgres://admin:', 'hunter2pass@db.internal:5432/app')],
    ['secret-assignment', j('password', '=', 'hunter2pass')],
    ['secret-assignment', j('API_KEY', ': "', 'abcd1234efgh', '"')],
    ['email', j('cliente', '@', 'gmail.com')],
  ])('detects %s', (rule, secret) => {
    expect(scanFields({ what: `before ${secret} after` })).toContainEqual({ field: 'what', rule });
  });

  it.each([
    'Token expiry check used < instead of <=',
    'The password field is required by the DTO',
    'api_key: <your-key>',
    'password=${DB_PASSWORD}',
    'See https://github.com/acme/shop-api and DEV-1876',
    'commit 4536c59f0a1b2c3d4e5f60718293a4b5c6d7e8f9',
    'package @types/node@22.1.0',
    'contact dev@example.com',
  ])('does not flag ordinary text: %s', (text) => {
    expect(scanFields({ what: text })).toEqual([]);
  });

  it('names every offending field and skips empty ones', () => {
    const token = j('ghp_', 'b'.repeat(36));
    expect(scanFields({ title: token, what: null, learned: token })).toEqual([
      { field: 'title', rule: 'github-token' },
      { field: 'learned', rule: 'github-token' },
    ]);
  });

  it('replaces the home directory with ~', () => {
    expect(redactHome('see /home/ana/code/x.ts', '/home/ana')).toBe('see ~/code/x.ts');
    expect(redactHome('/home/anabel/x', '/home/ana')).toBe('/home/anabel/x');
  });
});
