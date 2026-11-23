/*
 * Free text from SoundCloud can carry links, and they are plain text there.
 * This turns them into real anchors that follow the theme, without pulling in
 * a markdown renderer for what is only ever a URL in a sentence.
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

function hrefFor(raw) {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
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
    if (bare && /[@\w/.-]/.test(before)) {
      last = match.index + match[0].length;
      continue;
    }

    if (match.index > last) out.push(source.slice(last, match.index));
    out.push(
      <a
        key={`${match.index}-${raw}`}
        href={hrefFor(raw)}
        target="_blank"
        rel="noreferrer noopener"
        className="font-medium text-primary underline-offset-2 hover:underline break-words"
      >
        {raw}
      </a>
    );
    if (tail) out.push(tail);
    last = match.index + match[0].length;
  }

  if (out.length === 0) return source;
  if (last < source.length) out.push(source.slice(last));
  return out;
}
