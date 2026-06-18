import { Html, Head, Main, NextScript } from 'next/document';

/**
 * Inline script that sets `dark` on <html> before React mounts so the page
 * doesn't flash light-mode while the bundle is loading.
 */
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('overhearr-theme');
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = (stored === 'dark' || stored === 'light') ? stored : (prefersDark ? 'dark' : 'light');
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    document.documentElement.style.colorScheme = theme;
  } catch (_e) {
    // localStorage unavailable: fall back to dark (brand default).
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }
})();
`;

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        <meta name="theme-color" content="#17141a" />
        <link rel="icon" href="/overhearr.png" />
        <link rel="preload" as="image" href="/overhearr.png" />
        {/* FOUC prevention for theme — must run before <Main /> hydrates */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
