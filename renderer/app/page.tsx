"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";

export default function Page() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/Plan");
  }, [router]);
  return (
    <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
      <CircularProgress size={60} thickness={4} />
    </Box>
  );
}
