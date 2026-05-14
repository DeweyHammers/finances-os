"use client";

import { Card, CardContent, Typography, Box } from "@mui/material";

interface DashboardCardProps {
  name: string;
  amount: number;
  subtitle?: string;
  color?: string;
  isCurrency?: boolean;
  suffix?: string;
  precision?: number;
}

export const DashboardCard: React.FC<DashboardCardProps> = ({
  name,
  amount,
  subtitle,
  color = "primary.main",
  isCurrency = true,
  suffix = "",
  precision = 2,
}) => {
  const cleanName = name.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, "");
  const cleanSubtitle = subtitle?.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, "");

  return (
    <Card
      elevation={0}
      sx={{
        mb: 1.5,
        bgcolor: "rgba(15, 23, 42, 0.4)",
        borderRadius: 3,
        border: "1px solid rgba(255, 255, 255, 0.03)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle indicator bar */}
      <Box
        sx={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          bgcolor: color,
          opacity: 0.8,
        }}
      />

      <CardContent sx={{ py: 2, px: 2.5, "&:last-child": { pb: 2 } }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
          }}
        >
          <Box sx={{ flex: 1, textAlign: "left" }}>
            <Typography
              variant="body1"
              sx={{
                fontWeight: 700,
                color: "white",
                display: "block",
                textAlign: "left",
                m: 0,
                p: 0,
              }}
            >
              {cleanName}
            </Typography>
            {cleanSubtitle && (
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  display: "block",
                  textAlign: "left",
                  mt: 0.5,
                }}
              >
                {cleanSubtitle}
              </Typography>
            )}
          </Box>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 900,
              color: color === "primary.main" ? "primary.light" : color,
              ml: 2,
              whiteSpace: "nowrap",
              letterSpacing: -0.5,
            }}
          >
            {isCurrency ? "$" : ""}
            {Number(amount).toLocaleString(undefined, {
              minimumFractionDigits: precision,
              maximumFractionDigits: precision,
            })}
            {suffix}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};
