'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { Brand } from './ui/Brand';
import { Icon, type IconName } from './ui/Icon';
import { usePreviewRole } from './AdminPreview';
const creatorLinks: { href: string; label: string; icon: IconName }[] = [
  { href: '/projects', label: 'My projects', icon: 'grid' },
  { href: '/styles', label: 'Style library', icon: 'sliders' },
  { href: '/usage', label: 'My usage', icon: 'activity' },
];
const adminLinks: { href: string; label: string; icon: IconName }[] = [
  { href: '/admin', label: 'Overview', icon: 'grid' },
  { href: '/admin/users', label: 'Users & access', icon: 'users' },
  { href: '/admin/ips', label: 'IP activity', icon: 'globe' },
  { href: '/admin/settings', label: 'Runtime limits', icon: 'sliders' },
  { href: '/admin/audit', label: 'Audit log', icon: 'list' },
];
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const admin = path.startsWith('/admin');
  const editor = path.startsWith('/editor');
  const NavLink = editor ? 'a' : Link;
  const role = usePreviewRole();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (!mobile || !menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
      if (event.key !== 'Tab') return;
      const items = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>('a, button:not(:disabled)') ?? [],
      ).filter((item) => item.offsetParent !== null);
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
      menuButtonRef.current?.focus();
    };
  }, [mobile, menuOpen]);
  const { user, role: accountRole, signOut } = useAuth();
  const links = admin
    ? adminLinks.filter(
        (link) => role === 'admin' || !['/admin/settings', '/admin/audit'].includes(link.href),
      )
    : creatorLinks;
  const active = (href: string) => (href === '/admin' ? path === href : path.startsWith(href));
  return (
    <div className={`app-shell ${editor ? 'editor-shell' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {menuOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        className={`sidebar ${menuOpen ? 'is-open' : ''}`}
        inert={mobile && !menuOpen}
        role={mobile ? 'dialog' : undefined}
        aria-modal={mobile && menuOpen ? true : undefined}
        aria-label="Studio navigation"
      >
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="workspace-label">
          <span className="workspace-avatar">{admin ? 'RC' : 'YS'}</span>
          <div>
            <strong>{admin ? 'ReelCraft console' : 'Your studio'}</strong>
            <span>{admin ? 'Administration preview' : 'A little footage. A great story.'}</span>
          </div>
        </div>
        <a href="/editor" className="button primary sidebar-create">
          <Icon name="plus" size={18} /> Create a reel
        </a>
        <p className="nav-label">{admin ? 'MANAGEMENT' : 'WORKSPACE'}</p>
        <nav aria-label={admin ? 'Administration' : 'Workspace'} className="sidebar-nav">
          {links.map(({ href, label, icon }) => (
            <NavLink
              key={href}
              href={href}
              onClick={() => setMenuOpen(false)}
              className={active(href) ? 'active' : ''}
              aria-current={active(href) ? 'page' : undefined}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {active(href) && <span className="nav-active-dot" />}
            </NavLink>
          ))}
        </nav>
        {editor && (
          <a href="/editor" className="editor-nav-current">
            <Icon name="film" /> Reel editor <span className="nav-active-dot" />
          </a>
        )}
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <Icon name="shield" />
            <strong>Your moments stay yours.</strong>
            <p>Your videos stay on your device. Always.</p>
          </div>
          <nav className="sidebar-nav" aria-label="Account and help">
            <NavLink
              href="/help"
              className={active('/help') ? 'active' : ''}
              onClick={() => setMenuOpen(false)}
            >
              <Icon name="help" /> Help & getting started
            </NavLink>
            <NavLink
              href="/account"
              className={active('/account') ? 'active' : ''}
              onClick={() => setMenuOpen(false)}
            >
              <Icon name="settings" /> Account settings
            </NavLink>
            {(admin || accountRole === 'admin') && (
              <NavLink href={admin ? '/projects' : '/admin'} onClick={() => setMenuOpen(false)}>
                <Icon name={admin ? 'grid' : 'shield'} />
                {admin ? 'Back to studio' : 'Console preview'}
              </NavLink>
            )}
          </nav>
          <div className="sidebar-profile">
            <span className="avatar">{(user?.displayName ?? 'Creator').slice(0, 1)}</span>
            <div>
              <strong>{user?.displayName ?? 'Hello, creator'}</strong>
              <span>{user ? 'Personal workspace' : 'Explore your workspace'}</span>
            </div>
            {user ? (
              <button className="icon-button" aria-label="Sign out" onClick={() => void signOut()}>
                <Icon name="logout" size={17} />
              </button>
            ) : (
              <a href="/login" className="icon-button" aria-label="Sign in">
                <Icon name="arrow" size={17} />
              </a>
            )}
          </div>
        </div>
      </aside>
      <div className="app-body" inert={mobile && menuOpen}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              ref={menuButtonRef}
              aria-label="Open navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <span>{admin ? 'Console' : 'Workspace'}</span>
            <Icon name="chevron" size={13} />
            <strong>
              {editor
                ? 'Reel editor'
                : (links.find((link) => active(link.href))?.label ??
                  (path.startsWith('/account') ? 'Account settings' : 'Help & getting started'))}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span /> {admin ? 'Sample data' : 'Made on your device'}
            </span>
            <a href="/help" className="icon-button" aria-label="Help">
              <Icon name="help" size={19} />
            </a>
          </div>
        </header>
        <main id="main-content" className="app-content">
          {children}
        </main>
        <footer className="app-footer">
          <span>Made for the moments worth keeping.</span>
          <div>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/licenses">Licenses</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
