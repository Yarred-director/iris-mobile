import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="sk">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
        <meta name="theme-color" content="#0b0b0f" />
        <meta name="color-scheme" content="dark" />
        <meta name="application-name" content="Iris" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Iris" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/iris-icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/iris-icon.svg" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `
          html, body { width: 100%; height: 100%; margin: 0; background: #0b0b0f; }
          #root { width: 100%; height: var(--iris-visual-height, 100dvh); min-height: 0; background: #0b0b0f; }
          body { overflow: hidden; overscroll-behavior: none; }
          input, textarea { font-size: 16px !important; }
          * { box-sizing: border-box; }
        ` }} />
        <script dangerouslySetInnerHTML={{ __html: `
          (function () {
            function syncVisualViewport() {
              var viewport = window.visualViewport;
              var height = viewport && viewport.height ? viewport.height : window.innerHeight;
              document.documentElement.style.setProperty('--iris-visual-height', Math.round(height) + 'px');
            }
            syncVisualViewport();
            window.addEventListener('resize', syncVisualViewport, { passive: true });
            if (window.visualViewport) {
              window.visualViewport.addEventListener('resize', syncVisualViewport, { passive: true });
              window.visualViewport.addEventListener('scroll', syncVisualViewport, { passive: true });
            }
          })();
        ` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
