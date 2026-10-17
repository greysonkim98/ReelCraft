'use client';
import { useState } from 'react';
import { COLOR_LOOKS, SUBTITLE_STYLES, TEMPOS } from '@reelcraft/shared';
import { Icon } from './ui/Icon';
const descriptions: Record<string, string> = {
  natural: 'True to the moment.',
  warm: 'A little golden-hour glow.',
  cool: 'Fresh air, cooler tones.',
  vivid: 'Turn up the color.',
  film: 'A touch of nostalgia.',
  mono: 'Keep it timeless.',
};
export function StyleLibrary() {
  const [color, setColor] = useState('natural');
  const [subtitle, setSubtitle] = useState('classic');
  const [tempo, setTempo] = useState('energetic');
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SET THE FEELING</span>
          <h1>
            A look for every story<span className="mint">.</span>
          </h1>
          <p>A little mood. A little rhythm. A whole lot of you.</p>
        </div>
      </div>
      <div className="style-layout">
        <div className="style-controls">
          <section>
            <div className="section-heading">
              <h2>Color looks</h2>
              <span className="muted">06 curated looks</span>
            </div>
            <div className="look-grid">
              {COLOR_LOOKS.map((look) => (
                <button
                  key={look}
                  className={`look-card ${color === look ? 'selected' : ''}`}
                  onClick={() => setColor(look)}
                  aria-pressed={color === look}
                >
                  <div className="look-image">
                    <img className={`look-${look}`} src="/images/alpine-lake.jpg" alt="" />
                    {color === look && (
                      <span className="look-check">
                        <Icon name="check" size={15} />
                      </span>
                    )}
                  </div>
                  <strong>{look}</strong>
                  <span>{descriptions[look]}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Say it your way</h2>
            <p>Four caption styles that let your words stand out.</p>
            <div className="subtitle-grid">
              {SUBTITLE_STYLES.map((style) => (
                <button
                  className={`subtitle-card ${subtitle === style ? 'selected' : ''}`}
                  key={style}
                  onClick={() => setSubtitle(style)}
                  aria-pressed={subtitle === style}
                >
                  <span className={`caption-${style}`}>Stay a little longer.</span>
                  <small>{style}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Find your rhythm</h2>
            <div className="tempo-grid">
              {TEMPOS.map((pace) => (
                <button
                  key={pace}
                  onClick={() => setTempo(pace)}
                  aria-pressed={tempo === pace}
                  className={`tempo-card ${tempo === pace ? 'selected' : ''}`}
                >
                  <Icon name={pace === 'energetic' ? 'activity' : 'volume'} />
                  <strong>{pace}</strong>
                  <span>
                    {pace === 'energetic' ? 'Quick 1–2 second cuts' : 'Easy 3–5 second cuts'}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
        <aside className="style-preview">
          <div className="preview-heading">
            <span className="eyebrow">STYLE PREVIEW</span>
            <span className="count-pill">9:16</span>
          </div>
          <div className="style-phone">
            <img
              src="/images/alpine-lake.jpg"
              alt={`${color} color look preview of an alpine lake`}
              className={`look-${color}`}
            />
            <span className="phone-kicker">THE ART OF GETTING LOST</span>
            <span className={`phone-caption caption-${subtitle}`}>Stay a little longer.</span>
            <span className="phone-footer">REELCRAFT ORIGINAL</span>
          </div>
          <p className="muted preview-caption">
            {color} · {subtitle} captions · {tempo}
          </p>
          <a
            href={`/editor?look=${color}&subtitle=${subtitle}&tempo=${tempo}`}
            className="button primary"
          >
            Create with this style <Icon name="arrow" size={17} />
          </a>
          <p className="fine-print">
            Visual approximation. Final color and captions are applied when you render.
          </p>
        </aside>
      </div>
    </>
  );
}
