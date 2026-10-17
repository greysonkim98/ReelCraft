import type { ReactNode } from 'react';
import { Brand } from './ui/Brand';

const operator = process.env.NEXT_PUBLIC_OPERATOR_NAME;
const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

/** Owner details are configuration, never hard-coded. Until they are set the page says so. */
export const legalConfigured = Boolean(operator && contact);

export function Contact() {
  return contact ? (
    <a className="underline" href={`mailto:${contact}`}>
      {contact}
    </a>
  ) : (
    <strong>[contact email not configured]</strong>
  );
}

export function Operator() {
  return <>{operator ?? <strong>[operator name not configured]</strong>}</>;
}

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="legal-surface">
      <Brand />
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="text-xs text-slate-500">Last updated {updated}</p>
      {!legalConfigured && (
        <p role="note" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Draft: the operator name and contact email have not been configured for this build
          (NEXT_PUBLIC_OPERATOR_NAME, NEXT_PUBLIC_CONTACT_EMAIL). Have this text reviewed by a
          lawyer before launch.
        </p>
      )}
      {children}
      <nav className="legal-nav" aria-label="Legal and workspace">
        <a href="/projects">Back to studio</a>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/licenses">Licenses</a>
      </nav>
    </main>
  );
}

export const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="pt-2 text-base font-semibold text-slate-900">{children}</h2>
);
