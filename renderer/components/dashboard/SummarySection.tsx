"use client";

import { Box, Typography, Paper, Divider } from "@mui/material";

interface SummarySectionProps {
  title: string;
  totalLabel?: string;
  totalAmount?: number;
  customTotal?: string;
  children: React.ReactNode;
  sx?: any;
  icon?: React.ReactNode;
}

export const SummarySection: React.FC<SummarySectionProps> = ({
  title,
  totalLabel,
  totalAmount,
  customTotal,
  children,
  sx = {},
  icon,
}) => {
  const showSummary =
    totalLabel !== undefined &&
    (totalAmount !== undefined || customTotal !== undefined);

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 3, md: 4 },
        borderRadius: 4,
        bgcolor: "rgba(30, 41, 59, 0.5)",
        border: "1px solid rgba(129, 140, 248, 0.1)",
        minHeight: "auto",
        width: "100%",
        position: "relative",
        overflow: "hidden",
        ...sx,
      }}
    >
      <Box sx={{ mb: showSummary ? 4 : 3 }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexDirection: { xs: "column", sm: "row" },
            gap: 2,
          }}
        >
          <Typography
            variant="h5"
            sx={{
              fontWeight: 900,
              letterSpacing: "-0.5px",
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              color: "white",
            }}
          >
            {icon && (
              <Box
                sx={{
                  display: "flex",
                  p: 1,
                  borderRadius: 2,
                  bgcolor: "primary.main",
                  boxShadow: "0 0 15px rgba(129, 140, 248, 0.3)",
                  color: "white",
                }}
              >
                {icon}
              </Box>
            )}
            {title}
          </Typography>

          {showSummary && (
            <Box
              sx={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: { xs: "flex-start", sm: "flex-end" },
                bgcolor: "rgba(15, 23, 42, 0.3)",
                px: 3,
                py: 1.5,
                borderRadius: 3,
                border: "1px solid rgba(255, 255, 255, 0.05)",
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  fontWeight: 900,
                  letterSpacing: "1px",
                  mb: 0.5,
                  textTransform: "uppercase",
                }}
              >
                {totalLabel}
              </Typography>
              <Typography
                variant="h5"
                sx={{ fontWeight: 900, color: "primary.light" }}
              >
                {customTotal
                  ? customTotal
                  : `$${totalAmount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      <Divider sx={{ opacity: 0.05, mb: 4 }} />

      {children}
    </Paper>
  );
};
