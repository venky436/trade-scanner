import "./globals.css";
import { Geist, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { MarketDataProvider } from "@/context/market-data-context";

export const metadata = {
  title: "Trading Scanner",
  description: "Real-time market scanner",
};

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("dark font-sans", geist.variable, jetbrainsMono.variable)}>
      <body className="min-h-screen antialiased">
        <MarketDataProvider>{children}</MarketDataProvider>
      </body>
    </html>
  );
}
