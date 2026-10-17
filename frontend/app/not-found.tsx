import { Brand } from '@/components/ui/Brand';
import { Icon } from '@/components/ui/Icon';
export default function NotFound() {
  return (
    <main className="legal-surface">
      <Brand />
      <div className="empty-state">
        <Icon name="film" size={42} />
        <span className="eyebrow">404 / A MISSING SCENE</span>
        <h1>This page didn’t make the cut.</h1>
        <p>Let’s get you back to your stories.</p>
        <a href="/projects" className="button primary">
          Back to the studio <Icon name="arrow" size={17} />
        </a>
      </div>
    </main>
  );
}
