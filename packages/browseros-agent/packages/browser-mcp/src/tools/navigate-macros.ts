export const SEARCH_MACROS = [
  '@google_search',
  '@youtube_search',
  '@amazon_search',
  '@reddit_search',
  '@wikipedia_search',
  '@twitter_search',
  '@yelp_search',
  '@spotify_search',
  '@netflix_search',
  '@linkedin_search',
  '@instagram_search',
  '@tiktok_search',
  '@twitch_search',
] as const

export type SearchMacro = (typeof SEARCH_MACROS)[number]

const MACRO_TEMPLATES: Record<SearchMacro, string> = {
  '@google_search': 'https://www.google.com/search?q={q}',
  '@youtube_search': 'https://www.youtube.com/results?search_query={q}',
  '@amazon_search': 'https://www.amazon.com/s?k={q}',
  '@reddit_search': 'https://www.reddit.com/search/?q={q}',
  '@wikipedia_search': 'https://en.wikipedia.org/w/index.php?search={q}',
  '@twitter_search': 'https://twitter.com/search?q={q}',
  '@yelp_search': 'https://www.yelp.com/search?find_desc={q}',
  '@spotify_search': 'https://open.spotify.com/search/{q}',
  '@netflix_search': 'https://www.netflix.com/search?q={q}',
  '@linkedin_search':
    'https://www.linkedin.com/search/results/all/?keywords={q}',
  '@instagram_search':
    'https://www.instagram.com/explore/search/keyword/?q={q}',
  '@tiktok_search': 'https://www.tiktok.com/search?q={q}',
  '@twitch_search': 'https://www.twitch.tv/search?term={q}',
}

export function expandMacro(macro: SearchMacro, query: string): string {
  const template = MACRO_TEMPLATES[macro]
  const encoded = encodeURIComponent(query)
  return template.replace('{q}', encoded)
}
