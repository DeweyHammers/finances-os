"use client";

import { Box, Typography, Paper, Divider } from "@mui/material";

interface SummarySectionProps {
  title: string;
  totalLabel?: string;
  totalAmount?: number;
  customTotal?: string;
  children: React.ReactNode;
  sx?: any;
}

export const SummarySection: React.FC<SummarySectionProps> = ({
  title,
  totalLabel,
  totalAmount,
  customTotal,
  children,
  sx = {},
}) => {
  const showSummary =
    totalLabel !== undefined &&
    (totalAmount !== undefined || customTotal !== undefined);

  return (
    <Paper
      sx={{
        p: 5,
        borderRadius: 2,
        bgcolor: "#1e293b",
        backgroundImage:
          "radial-gradient(at 0% 0%, rgba(129, 140, 248, 0.08) 0, transparent 50%)",
        border: "1px solid rgba(255, 255, 255, 0.05)",
        boxShadow: "0 10px 30px -10px rgba(0,0,0,0.5)",
        minHeight: "auto",
        width: "100%",
        ...sx,
      }}
    >
      <Box sx={{ mb: showSummary ? 5 : 2, textAlign: "center" }}>
        <Typography
          variant="h4"
          sx={{
            fontWeight: 800,
            mb: showSummary ? 3 : 0,
            letterSpacing: "0.5px",
          }}
        >
          {title}
        </Typography>

        {showSummary && (
          <Box
            sx={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              bgcolor: "rgba(255,255,255,0.03)",
              px: 6,
              py: 2,
              borderRadius: 2,
              border: "1px solid rgba(255, 255, 255, 0.05)",
            }}
          >
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                fontWeight: 900,
                letterSpacing: "2px",
                mb: 0.5,
              }}
            >
              {totalLabel}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, color: "white" }}>
              {customTotal ? customTotal : `$${totalAmount?.toFixed(2)}`}
            </Typography>
          </Box>
        )}
      </Box>

      <Divider sx={{ opacity: 0.1, mb: 4 }} />

      {children}
    </Paper>
  );
};
