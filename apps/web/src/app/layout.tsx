import "./globals.css";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { MarketDataProvider } from "@/context/market-data-context";
import { ThemeProvider } from "next-themes";
import { AppShell } from "@/components/app-shell";

export const metadata = {
  title: "Trading Scanner",
  description: "Real-time market scanner",
};

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
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
    <html lang="en" className={cn("font-sans", inter.variable, jetbrainsMono.variable)} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <MarketDataProvider>
            <AppShell>{children}</AppShell>
          </MarketDataProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
