/**
 * layout.tsx — Root HTML shell for the Next.js app router.
 *
 * Wraps every route in the app-wide Providers tree (Refine, MUI theme, KBar,
 * date-picker localization, Snackbar). This file intentionally stays minimal:
 * all client-side setup lives in providers.tsx so the layout itself can remain
 * a server component and set metadata cleanly.
 */

import { Metadata } from "next";
import { Providers } from "./providers";
import { ReactNode } from "react";

// Static <title> / <meta description> for the Electron webview.
export const metadata: Metadata = {
  title: "Finances OS",
  description: "Custom Finances OS Desktop Application",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
