/*
 * A detail page puts its artwork on the right and everything else on the left.
 * The artwork, the artist card and every box under them share one column width,
 * so the right edge reads as a single line all the way down the page. Songs,
 * playlists and albums all use the same grid, which keeps the three pages from
 * drifting apart.
 */
export const DETAIL_GRID = 'lg:grid-cols-[minmax(0,1fr)_20rem]';
