import Link from 'next/link';
import { Brand } from './ui/Brand';
import { Icon } from './ui/Icon';
export function HomeLanding() {
  return (
    <div className="landing">
      <header className="marketing-header">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <Link href="/styles">Explore styles</Link>
        </nav>
        <Link href="/login" className="button secondary">
          Sign in <Icon name="arrow" size={16} />
        </Link>
      </header>
      <main>
        <section className="landing-hero">
          <div className="landing-copy">
            <span className="eyebrow">
              <span className="status-dot" /> YOUR MOMENTS. BEAUTIFULLY RECRAFTED.
            </span>
            <h1>
              Less editing.
              <br />
              More <span>living.</span>
            </h1>
            <p>
              Turn the clips in your camera roll into a reel worth sharing. A little AI magic. Your
              creative touch. All on your device.
            </p>
            <div className="hero-actions">
              <Link href="/projects" className="button primary large">
                Enter your studio <Icon name="arrow" size={19} />
              </Link>
              <a href="#how-it-works" className="text-link">
                <span className="small-play">
                  <Icon name="play" size={13} />
                </span>{' '}
                See how it works
              </a>
            </div>
            <div className="hero-assurances">
              <span>
                <Icon name="check" size={15} /> Free to create
              </span>
              <span>
                <Icon name="shield" size={15} /> No video uploads
              </span>
              <span>
                <Icon name="film" size={15} /> Made for 9:16
              </span>
            </div>
          </div>
          <div
            className="hero-composition"
            aria-label="Example vertical reel with alpine lake scenery"
          >
            <div className="floating-label label-top">
              <span className="mint-icon">
                <Icon name="sparkles" />
              </span>
              <div>
                <strong>Your footage, reimagined</strong>
                <span>A story in every little moment</span>
              </div>
            </div>
            <div className="hero-reel reel-back">
              <img src="/images/ocean.jpg" alt="Waves washing onto a sandy beach" />
              <span>Chasing the coast.</span>
            </div>
            <div className="hero-reel reel-front">
              <img
                src="/images/alpine-lake.jpg"
                alt="Turquoise alpine lake surrounded by mountains"
              />
              <div className="reel-top">
                <span>REELCRAFT ORIGINAL</span>
                <Icon name="volume" size={16} />
              </div>
              <div className="reel-caption">
                <span>WEEKEND DIARIES / 01</span>
                <strong>
                  A little further.
                  <br />A little freer.
                </strong>
              </div>
              <div className="reel-bottom">
                <Icon name="play" size={16} />
                <span className="mini-timeline" />
                <span>00:32</span>
              </div>
            </div>
            <div className="floating-label label-bottom">
              <Icon name="shield" />
              <span>Big memories. Zero uploads.</span>
            </div>
            <span className="composition-scribble">From camera roll to main character.</span>
          </div>
        </section>
        <section className="how-section" id="how-it-works">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE GOOD PART, WITHOUT THE HARD PART</span>
              <h2>From a few clips to a whole story.</h2>
            </div>
            <Link className="text-link" href="/help">
              A quick look around <Icon name="arrow" size={17} />
            </Link>
          </div>
          <div className="how-grid">
            {[
              {
                n: '01',
                icon: 'upload' as const,
                title: 'Bring your moments',
                copy: 'Drop in your favorite clips. Add a note to give your story a little context.',
              },
              {
                n: '02',
                icon: 'sparkles' as const,
                title: 'Find your rhythm',
                copy: 'Choose a look, find the best scenes, and give them a voice with AI captions.',
              },
              {
                n: '03',
                icon: 'film' as const,
                title: 'Make it yours',
                copy: 'Fine-tune the details, render your reel, and share it wherever you like.',
              },
            ].map((item) => (
              <article key={item.n}>
                <div>
                  <span className="feature-icon">
                    <Icon name={item.icon} size={22} />
                  </span>
                  <span className="step-number">{item.n}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="marketing-footer">
        <Brand />
        <span>Small moments. Great stories.</span>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/licenses">Licenses</Link>
        </div>
      </footer>
    </div>
  );
}
