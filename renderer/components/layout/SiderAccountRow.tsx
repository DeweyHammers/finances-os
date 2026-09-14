"use client";

/**
 * SiderAccountRow — one account entry in the sider's Cash section.
 *
 * Renders the account name + formatted balance and routes to /Cash?id=<id> on
 * click. Highlights when active. Exposes an on-hover pencil icon that fires
 * `onEdit(id)` (bubbling is stopped so the parent row's navigation doesn't
 * also trigger). Rendered by CustomSider inside the Cash <Collapse>.
 */

import { Box, IconButton, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { formatMoney } from "../../lib/cents";

interface SiderAccountRowProps {
  id: string;
  name: string;
  balanceCents: number;
  onEdit: (id: string) => void;
}

export const SiderAccountRow = ({
  id,
  name,
  balanceCents,
  onEdit,
}: SiderAccountRowProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // "Active" = we're on the /Cash page AND this row's account id matches the
  // ?id= query. Two-part check so the highlight moves as the user clicks
  // between accounts (path doesn't change, only the query does).
  const onCashPath = pathname === "/Cash" || pathname?.startsWith("/Cash/");
  const active = !!onCashPath && searchParams?.get("id") === id;
  const target = `/Cash?id=${id}`;

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={() => router.push(target)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(target);
      }}
      sx={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        pl: 4,
        pr: 2,
        py: 1,
        mx: 1.5,
        my: 0.25,
        borderRadius: "8px",
        cursor: "pointer",
        bgcolor: active ? "rgba(129, 140, 248, 0.15)" : "transparent",
        "&:hover": {
          bgcolor: active
            ? "rgba(129, 140, 248, 0.20)"
            : "rgba(129, 140, 248, 0.08)",
          "& .sider-account-pencil": { opacity: 1 },
        },
        "&:focus-visible": {
          outline: "2px solid rgba(129, 140, 248, 0.5)",
          outlineOffset: -2,
        },
      }}
    >
      {/* Pencil is hidden by default and fades in via CSS on row hover (see
          `.sider-account-pencil` opacity rules in the parent Box sx). */}
      <IconButton
        className="sider-account-pencil"
        aria-label={`Edit ${name}`}
        onClick={(e) => {
          // Stop propagation so clicking the pencil doesn't ALSO trigger the
          // row's navigation to /Cash?id=<id>.
          e.stopPropagation();
          onEdit(id);
        }}
        size="small"
        sx={{
          position: "absolute",
          left: 4,
          top: "50%",
          transform: "translateY(-50%)",
          opacity: 0,
          transition: "opacity 120ms",
          color: "primary.light",
          width: 24,
          height: 24,
        }}
      >
        <EditIcon sx={{ fontSize: 14 }} />
      </IconButton>
      <Typography
        sx={{
          fontSize: "0.95rem",
          fontWeight: 600,
          color: active ? "primary.light" : "white",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </Typography>
      <Typography
        sx={{
          fontSize: "0.9rem",
          fontWeight: 700,
          color: active ? "primary.light" : "white",
          fontVariantNumeric: "tabular-nums",
          ml: 1,
        }}
      >
        {formatMoney(balanceCents)}
      </Typography>
    </Box>
  );
};
