import glyphOnDark from '../../../../assets/brand/tether-glyph-dark.svg';
import glyphOnLight from '../../../../assets/brand/tether-glyph-light.svg';
import './parts.css';

/** The Tether mark (the Gapped Triad). Both theme drawings are in the page and data-theme shows the right one, so nothing has to follow the theme. */
export function Glyph(props: { size?: number; className?: string }) {
  const size = props.size ?? 30;
  return (
    <span className={props.className ? `sl-glyph ${props.className}` : 'sl-glyph'} aria-hidden="true">
      <img className="sl-glyph-light" src={glyphOnLight} width={size} height={size} alt="" />
      <img className="sl-glyph-dark" src={glyphOnDark} width={size} height={size} alt="" />
    </span>
  );
}
