import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: { default: "Pepper", template: "%s · Pepper" },
  description: "Your music, everywhere. A self-hosted music player with smart recommendations.",
  applicationName: "Pepper",
  appleWebApp: { capable: true, title: "Pepper", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} h-full`}>
      <body className="h-full bg-black text-white antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
