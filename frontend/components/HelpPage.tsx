import { Icon } from './ui/Icon';
const faqs = [
  [
    'Where are my videos uploaded?',
    'Nowhere. Importing clips reads files on your device. Analysis, editing, and encoding happen inside your browser. Only text and scene metadata are sent when you request AI captions.',
  ],
  [
    'How do I make my first reel?',
    'Open Create a reel, sign in or explore the editor preview, then choose your clips. Pick a style, analyze the footage, add captions, review your scenes, and render. Download the finished MP4 or use the share sheet on a supported device.',
  ],
  [
    'Can I come back to a project later?',
    'Cloud project saving and restoration are planned. The project library currently uses sample data. For now, keep your editor tab open while working; refreshing or leaving the editor loses the current edit and selected clips.',
  ],
  [
    'What can I export?',
    'The current editor produces a vertical 720 × 1280 MP4, up to 60 seconds long. The proposal’s 1080p and AI narration options are planned for a later release.',
  ],
  [
    'What happens if I use all my AI generations?',
    'You can still change captions, trim and reorder scenes, and render as often as you like. The usage page shows your account’s current allowance and reset time.',
  ],
  [
    'Why is processing taking a while?',
    'Video processing uses your device. Longer clips and older devices take more time. Keep the tab open, close other heavy applications, and try a smaller selection of clips if needed.',
  ],
];
export function HelpPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A LITTLE HELP ALONG THE WAY</span>
          <h1>
            Let’s get you creating<span className="mint">.</span>
          </h1>
          <p>Everything you need to turn your moments into a story.</p>
        </div>
      </div>
      <div className="help-hero">
        <span className="feature-icon">
          <Icon name="film" size={28} />
        </span>
        <div>
          <h2>Your first reel starts with a few clips.</h2>
          <p>Our guided editor takes you from camera roll to your final cut, one step at a time.</p>
        </div>
        <a href="/editor" className="button primary">
          Open the editor <Icon name="arrow" size={17} />
        </a>
      </div>
      <section className="faq-list" aria-label="Frequently asked questions">
        {faqs.map(([question, answer], i) => (
          <details key={question} open={i === 0}>
            <summary>
              {question}
              <Icon name="plus" size={18} />
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </section>
      <div className="preview-note">
        <Icon name="shield" />
        <p>
          The management console requires a support or admin role. Account changes and network
          restrictions affect real access, and each change is recorded in the audit log.
        </p>
      </div>
    </>
  );
}
