import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="sk">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
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
          html, body, #root { height: 100%; margin: 0; background: #0b0b0f; }
          body { overflow: hidden; overscroll-behavior: none; }
          * { box-sizing: border-box; }
        ` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
