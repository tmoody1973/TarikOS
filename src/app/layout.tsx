import type { Metadata } from "next";
import { Antonio, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { AppShell } from "@/components/AppShell";
import { NotOwner } from "@/components/NotOwner";
import { isOwner } from "@/lib/owner";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { isAuthenticated } = await auth();
  // Single-user by design: a valid session that isn't the owner's gets the
  // wall, not the dashboard. Clerk's own restrictions stop new sign-ups;
  // this stops accounts that already exist. See src/lib/owner.ts.
  const owner = isAuthenticated ? await isOwner() : false;
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${antonio.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          <ConvexClientProvider>
            {isAuthenticated && !owner ? (
              <NotOwner />
            ) : (
              <AppShell signedIn={isAuthenticated}>{children}</AppShell>
            )}
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
