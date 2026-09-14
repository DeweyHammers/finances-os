"use client";

/**
 * app/page.tsx — Root route (/) redirector.
 *
 * The Plan (YNAB-style budget) is the app's default landing surface, so /
 * bounces immediately to /Plan. Shows a centered spinner during the brief
 * client-side navigation gap so the user never sees a blank screen.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";

export default function Page() {
  const router = useRouter();
  // Client-side redirect (not a Next redirect() call) because this file is a
  // "use client" component. router.replace avoids leaving / in the history
  // stack — hitting Back from /Plan shouldn't loop back through here.
  useEffect(() => {
    router.replace("/Plan");
  }, [router]);
  return (
    <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
      <CircularProgress size={60} thickness={4} />
    </Box>
  );
}
