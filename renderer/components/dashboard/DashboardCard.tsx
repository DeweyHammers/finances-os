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
  // Aggressive trim to remove standard spaces, non-breaking spaces, and tabs
  const cleanName = name.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, "");
  const cleanSubtitle = subtitle?.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, "");

  return (
    <Card
      sx={{
        mb: 1,
        bgcolor: "rgba(30, 41, 59, 0.4)",
        borderLeft: "3px solid",
        borderColor: color,
        height: "100%",
      }}
    >
      <CardContent sx={{ py: 1.25, px: 2, "&:last-child": { pb: 1.25 } }}>
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
              variant="body2"
              sx={{
                fontWeight: 700,
                color: "white",
                display: "block",
                fontSize: "0.95rem",
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
                  display: "block",
                  textAlign: "left",
                  m: 0,
                  p: 0,
                }}
              >
                {cleanSubtitle}
              </Typography>
            )}
          </Box>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 800,
              color: color === "primary.main" ? "primary.light" : color,
              ml: 2,
              whiteSpace: "nowrap",
            }}
          >
            {isCurrency ? "$" : ""}
            {Number(amount).toFixed(precision)}
            {suffix}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};
