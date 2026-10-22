import { describe, expect, it } from 'vitest';
import { canAccessAdminPage } from './admin-access';

describe('console access', () => {
  it.each(['/admin', '/admin/users', '/admin/ips', '/admin/settings', '/admin/audit'])(
    'allows admins and denies ordinary/signed-out users at %s',
    (path) => {
      expect(canAccessAdminPage('admin', path)).toBe(true);
      expect(canAccessAdminPage('user', path)).toBe(false);
      expect(canAccessAdminPage(null, path)).toBe(false);
    },
  );
  it.each(['/admin', '/admin/users', '/admin/users/alice', '/admin/ips'])(
    'allows support to inspect %s',
    (path) => expect(canAccessAdminPage('support', path)).toBe(true),
  );
  it.each(['/admin/settings', '/admin/audit', '/admin/settings/limits', '/admin/ips-secret'])(
    'keeps support out of %s',
    (path) => expect(canAccessAdminPage('support', path)).toBe(false),
  );
});
