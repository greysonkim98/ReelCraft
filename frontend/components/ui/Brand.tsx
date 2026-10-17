import { Icon } from './Icon';
export function Brand() {
  return (
    <a href="/" className="brand" aria-label="ReelCraft home">
      <span className="brand-mark">
        <Icon name="film" size={22} />
      </span>
      <span>
        reelcraft<span className="brand-dot">.</span>
      </span>
    </a>
  );
}
