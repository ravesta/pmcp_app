import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, buildSecurityHeaders, createNonce } from '@/platform/security-headers';

describe('header keamanan', () => {
  it('CSP melarang frame, object, dan sumber luar; eval hanya di pengembangan', () => {
    const production = buildContentSecurityPolicy('abc123', false);
    expect(production).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(production).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(production).toContain("style-src 'self' 'nonce-abc123'");
    expect(production).toContain("frame-ancestors 'none'");
    expect(production).toContain("object-src 'none'");
    expect(production).toContain("default-src 'self'");
    expect(production).not.toContain('unsafe-eval');
    expect(buildContentSecurityPolicy('abc123', true)).toContain('unsafe-eval');
  });

  it('HSTS hanya bila transport aman; header dasar selalu ada', () => {
    const names = (secure: boolean) => buildSecurityHeaders({ secureTransport: secure }).map((h) => h.key);
    expect(names(true)).toContain('Strict-Transport-Security');
    expect(names(false)).not.toContain('Strict-Transport-Security');
    expect(createNonce()).not.toBe(createNonce());
    for (const key of ['X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cache-Control']) {
      expect(names(false)).toContain(key);
    }
  });
});
