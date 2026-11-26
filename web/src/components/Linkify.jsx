import { Link } from '@tanstack/react-router';

/*
 * Free text from SoundCloud can carry links and @mentions, and both are plain
 * text there. This turns them into real anchors that follow the theme, without
 * pulling in a markdown renderer for what is only ever a URL or a name in a
 * sentence.
 *
 * A link to a SoundCloud profile is not shown as its address. SoundCloud prints
 * it as the handle, `@name`, because that is what a listener recognises, and
 * this does the same: the handle is the link text and it points at the artist
 * page inside Fala.
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
 * SoundCloud's own fixed pages live at a single segment too, so they must not
 * be mistaken for a profile and turned into a handle. A real permalink is one
 * word, and these are the words the site keeps for itself.
 */
const SC_RESERVED = new Set([
  'discover', 'stream', 'you', 'charts', 'upload', 'search', 'settings',
  'notifications', 'messages', 'library', 'feed', 'tags', 'people', 'pages',
  'imprint', 'jobs', 'creators', 'artists', 'labels', 'pro', 'premium',
  'signin', 'signup', 'logout', 'oauth', 'connect', 'terms-of-use', 'privacy',
  'cookie', 'guidelines', 'community', 'help', 'support', 'mobile', 'apps',
]);

/*
 * The handle a SoundCloud profile address names, or null when the address is
 * anything else. Only a one-word path is a profile: two words are a song and
 * `/artist/sets/name` is a playlist, and neither has a handle to print.
 */
function profileHandle(raw) {
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'soundcloud.com' && host !== 'm.soundcloud.com') return null;
  const seg = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (seg.length !== 1) return null;
  const name = seg[0];
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) return null;
  if (SC_RESERVED.has(name.toLowerCase())) return null;
  return name;
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

    /*
     * A profile address is printed as the handle it names, and it points at
     * the artist page inside Fala rather than back out to SoundCloud. Anything
     * else keeps its own address and opens in a new tab.
     */
    const handle = profileHandle(raw);
    out.push(
      handle ? (
        <Link
          key={`${match.index}-${raw}`}
          to="/$artist"
          params={{ artist: handle }}
          className={LINK_CLASS}
        >
          @{handle}
        </Link>
      ) : (
        <a
          key={`${match.index}-${raw}`}
          href={hrefFor(raw)}
          target="_blank"
          rel="noreferrer noopener"
          className={LINK_CLASS}
        >
          {raw}
        </a>
      )
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
