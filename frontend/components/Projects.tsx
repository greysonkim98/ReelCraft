import { Icon } from './ui/Icon';

const EXAMPLE_REELS = [
  {
    id: 'example-01',
    title: 'Example reel 01',
    src: '/examples/reelcraft-2026-10-30.mp4',
    description: 'A little inspiration for your next story.',
  },
  {
    id: 'example-02',
    title: 'Example reel 02',
    src: '/examples/reelcraft-2026-11-08.mp4',
    description: 'See how a collection of clips comes together.',
  },
  {
    id: 'subtitled-example',
    title: 'A story with subtitles',
    src: '/examples/reel_subtitled.mp4',
    description: 'An example reel with subtitles.',
  },
];

export function Projects() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A SPACE FOR YOUR STORIES</span>
          <h1>
            My projects<span className="mint">.</span>
          </h1>
          <p>Big adventures. Everyday moments. Make something of them.</p>
        </div>
        <a href="/editor" className="button primary">
          <Icon name="plus" size={18} /> New reel
        </a>
      </div>
      <section className="studio-banner">
        <img src="/images/alpine-lake.jpg" alt="Mountains reflected in an alpine lake" />
        <div className="studio-banner-shade" />
        <div className="studio-banner-copy">
          <span className="eyebrow">
            <Icon name="sparkles" size={14} /> A LITTLE CREATIVE MOMENTUM
          </span>
          <h2>
            Your next great story
            <br />
            is already in your camera roll.
          </h2>
          <p>Bring the clips. We’ll help you find the magic.</p>
          <a href="/editor" className="button light">
            Let’s make a reel <Icon name="arrow" size={17} />
          </a>
        </div>
        <div className="banner-format">
          <Icon name="film" size={17} />
          <span>9:16 format</span>
          <span className="separator" /> <span>Up to 60 seconds</span>
        </div>
      </section>
      <div className="workspace-stats">
        <div>
          <span className="stat-icon">
            <Icon name="film" />
          </span>
          <div>
            <strong>{EXAMPLE_REELS.length.toString().padStart(2, '0')}</strong>
            <span>Example reels</span>
          </div>
        </div>
        <div>
          <span className="stat-icon">
            <Icon name="play" />
          </span>
          <div>
            <strong>Press play</strong>
            <span>See ReelCraft in action</span>
          </div>
        </div>
        <div>
          <span className="stat-icon">
            <Icon name="shield" />
          </span>
          <div>
            <strong>100% yours</strong>
            <span>Your footage stays on your device</span>
          </div>
        </div>
      </div>
      <section aria-labelledby="examples-heading">
        <div className="section-heading">
          <h2 id="examples-heading">
            Example reels <span className="count-pill">{EXAMPLE_REELS.length}</span>
          </h2>
        </div>
        <p className="examples-intro">
          See what you can make with ReelCraft. Play an example, then bring your own clips.
        </p>
        <div className="example-grid">
          {EXAMPLE_REELS.map((example) => (
            <article className="example-card" key={example.id}>
              <video
                className="example-video"
                controls
                playsInline
                preload="metadata"
                aria-labelledby={`${example.id}-title`}
              >
                <source src={example.src} type="video/mp4" />
                Your browser does not support video playback.{' '}
                <a href={example.src}>Download {example.title}</a> to watch it.
              </video>
              <div className="example-card-content">
                <h3 id={`${example.id}-title`}>{example.title}</h3>
                <p>{example.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="preview-note">
        <Icon name="film" size={16} />
        <p>
          <strong>A little inspiration.</strong> These are example videos, not saved projects.
          Create a reel with your own clips and download it to keep it.
        </p>
      </div>
    </>
  );
}
