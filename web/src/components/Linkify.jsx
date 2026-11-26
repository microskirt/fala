import { Link } from '@tanstack/react-router';

/*
 * Free text from SoundCloud can carry links and @mentions, and both are plain
 * text there. This turns them into real anchors that follow the theme, without
 * pulling in a markdown renderer for what is only ever a URL or a name in a
 * sentence.
 */

/*
 * Three shapes are worth catching: a full http(s) address, one that starts with
 * www, and a bare domain ending in a common ending. The last one is kept to a
 * known list so a sentence like "e.g." or a file name is not turned into a
 * link. The trailing punctuation is trimmed afterwards, because a sentence
 * often ends right against the address.
 */
const URL_RE = /\b(?:https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|de|fm|me|gg|tv|app|dev|link|xyz|info|biz|ru|uk|fr|nl|se|ch|at|be|it|es|pl|jp|kr|br|au|ca)(?:\/[^\s<>"']*)?)/gi;

const TRAILING = /[.,;:!?)\]}'"»]+$/;

/*
 * An @mention names a SoundCloud page, so it reads as a link to that page in
 * this app. The character in front decides whether it really is a mention: in
 * an email address the @ follows a word, so "someone@example.com" stays plain
 * text. A permalink is letters, digits, hyphens and underscores, so the run
 * stops at the first character outside that set and a trailing mark stays in
 * the sentence where it was written.
 */
const MENTION_RE = /(^|[^\w@/.-])@([a-z0-9][a-z0-9_-]*)/gi;

const LINK_CLASS =
  'font-medium text-primary underline-offset-2 hover:underline break-words';

function hrefFor(raw) {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/*
 * Turns the mentions in one plain stretch of text into links to the artist page
 * they name. The stretch is what sits between two URLs, so a name that is part
 * of an address is never touched: the URL pass already took it.
 */
function linkifyMentions(text, keyPrefix) {
  if (!text) return [text];

  const out = [];
  let last = 0;
  let match;
  MENTION_RE.lastIndex = 0;

  while ((match = MENTION_RE.exec(text))) {
    const lead = match[1];
    let name = match[2];
    let tail = '';
    // A permalink cannot end in a separator, so a stray one stays as text.
    const trailing = name.match(/[-_]+$/);
    if (trailing) {
      tail = trailing[0];
      name = name.slice(0, -tail.length);
    }

    const at = match.index + lead.length;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      <Link
        key={`${keyPrefix}-${at}`}
        to="/$artist"
        params={{ artist: name }}
        className={LINK_CLASS}
      >
        @{name}
      </Link>
    );
    if (tail) out.push(tail);
    last = at + 1 + name.length + tail.length;
  }

  if (out.length === 0) return [text];
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/*
 * Returns an array of strings and anchors, safe to drop inside a paragraph or
 * span. Plain text with no link comes back as the original string, so callers
 * do not have to care which case they got.
 */
export function linkify(text) {
  const source = String(text || '');
  if (!source) return source;

  const out = [];
  let last = 0;
  let match;
  URL_RE.lastIndex = 0;

  while ((match = URL_RE.exec(source))) {
    let raw = match[0];
    let tail = '';
    const trailing = raw.match(TRAILING);
    if (trailing) {
      tail = trailing[0];
      raw = raw.slice(0, -tail.length);
    }
    if (!raw) continue;

    /*
     * A bare domain inside an email address is not a link on its own, so the
     * character in front decides: after an @ it is part of the address and
     * stays plain text.
     */
    const before = match.index > 0 ? source[match.index - 1] : '';
    const bare = !/^https?:\/\//i.test(raw) && !/^www\./i.test(raw);
    /*
     * `last` is deliberately left where it was. Advancing it here used to drop
     * the address from the output when a real link came later in the same
     * sentence, because the plain stretch before that link started after the
     * email. Leaving it alone keeps the text and still refuses to link it.
     */
    if (bare && /[@\w/.-]/.test(before)) continue;

    if (match.index > last) out.push(source.slice(last, match.index));
    out.push(
      <a
        key={`${match.index}-${raw}`}
        href={hrefFor(raw)}
        target="_blank"
        rel="noreferrer noopener"
        className={LINK_CLASS}
      >
        {raw}
      </a>
    );
    if (tail) out.push(tail);
    last = match.index + match[0].length;
  }

  /*
   * No URL at all is the common case for a description, and mentions can still
   * be in it, so the whole string goes through the mention pass here.
   */
  if (out.length === 0) {
    const mentions = linkifyMentions(source, 'm');
    return mentions.length === 1 && mentions[0] === source ? source : mentions;
  }

  if (last < source.length) out.push(source.slice(last));

  /*
   * Mentions are only looked for in the plain stretches between the links, so a
   * name inside an address cannot be turned into a second link.
   */
  const result = [];
  out.forEach((piece, i) => {
    if (typeof piece === 'string') result.push(...linkifyMentions(piece, `m${i}`));
    else result.push(piece);
  });
  return result;
}
