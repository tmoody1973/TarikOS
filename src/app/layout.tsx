import type { Metadata } from "next";
import { Antonio, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const antonio = Antonio({
  variable: "--font-display",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono-hud",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tarik OS",
  description:
    "Zola — real-time personal AI. Chief of staff, second brain, thought partner.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${antonio.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          <ConvexClientProvider>
            <AppShell>{children}</AppShell>
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
