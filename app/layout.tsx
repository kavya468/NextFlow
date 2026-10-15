import type { Metadata } from "next";
import { APP_UI } from "@/lib/ui-config";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { TRPCProvider } from "@/lib/trpc/provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_UI.title,
  description: APP_UI.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <TRPCProvider>
        <html lang="en" suppressHydrationWarning className={inter.variable}>
          <body className="antialiased">
            <ThemeProvider>
              <TooltipProvider>
                {children}
                <Toaster position="bottom-right" richColors />
              </TooltipProvider>
            </ThemeProvider>
          </body>
        </html>
      </TRPCProvider>
    </ClerkProvider>
  );
}
