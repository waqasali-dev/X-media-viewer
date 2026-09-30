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
        <meta name="referrer" content="no-referrer" />
      </head>
      <body className="bg-neutral-950 text-neutral-100 antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
