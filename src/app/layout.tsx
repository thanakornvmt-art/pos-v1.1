import type { Metadata, Viewport } from "next";
import { Providers } from "@/providers/providers";
import { AppShell } from "@/components/app-shell";
import "./globals.css";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/600.css";
import "@fontsource/noto-sans-thai/700.css";
export const metadata: Metadata = {
  title: "ระบบขายหน้าร้าน",
  description: "ระบบขายโจ๊กและต้มเลือดหมู รองรับออฟไลน์",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fbbd14",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
