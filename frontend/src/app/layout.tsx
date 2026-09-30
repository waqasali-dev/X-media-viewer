import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "X Media Archive – infinite stream gallery",
  description:
    "Discover and stream every photo, video and GIF an X.com profile has ever posted. No official API, no local storage: media streams straight from X's CDN.",
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function() {
  try {
    const isExtAttr = (n) => typeof n === 'string' && (n === 'bis_skin_checked' || n.startsWith('bis_') || n.startsWith('__processed_'));
    const origSet = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, val) {
      if (isExtAttr(name)) return;
      return origSet.apply(this, arguments);
    };
    const observer = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'attributes' && isExtAttr(m.attributeName)) {
          m.target.removeAttribute(m.attributeName);
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      subtree: true,
    });
  } catch (e) {}
})();
`,
          }}
        />
      </head>
      <body className="bg-neutral-950 text-neutral-100 antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
