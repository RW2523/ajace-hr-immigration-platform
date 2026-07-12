import type { MetadataRoute } from 'next';

// This is a private internal HR/immigration tool — keep it out of search indexes.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
