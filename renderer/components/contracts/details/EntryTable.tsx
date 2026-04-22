"use client";

import { FC } from "react";
import {
  Paper,
  Box,
  Typography,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  IconButton,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import { formatDate } from "../../../lib/date-utils";

interface EntryTableProps {
  entries: any[];
  onEdit: (entry: any) => void;
  onDelete: (id: string) => void;
  contract?: any;
}

export const EntryTable: FC<EntryTableProps> = ({
  entries,
  onEdit,
  onDelete,
  contract,
}) => {
  const isHourly = contract?.type === "HOURLY";

  return (
    <Paper
      sx={{
        p: 0,
        bgcolor: "background.paper",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          p: 2,
          bgcolor: "rgba(255, 255, 255, 0.02)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Weekly Earnings History
        </Typography>
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "rgba(0,0,0,0.2)" }}>
              <TableCell sx={{ fontWeight: 700, color: "text.secondary" }}>
                WEEK (SATURDAY)
              </TableCell>
              {isHourly && (
                <TableCell sx={{ fontWeight: 700, color: "text.secondary" }}>
                  HOURS
                </TableCell>
              )}
              <TableCell sx={{ fontWeight: 700, color: "text.secondary" }}>
                GROSS PAY
              </TableCell>
              <TableCell sx={{ fontWeight: 700, color: "text.secondary" }}>
                NET PAY
              </TableCell>
              <TableCell
                align="right"
                sx={{ fontWeight: 700, color: "text.secondary" }}
              >
                ACTIONS
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isHourly ? 5 : 4}
                  align="center"
                  sx={{ py: 4, color: "text.secondary" }}
                >
                  No earnings entries yet.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry: any) => (
                <TableRow
                  key={entry.id}
                  sx={{ "&:hover": { bgcolor: "rgba(255,255,255,0.02)" } }}
                >
                  <TableCell sx={{ color: "white", fontWeight: 500 }}>
                    {formatDate(entry.date)}
                  </TableCell>
                  {isHourly && (
                    <TableCell sx={{ color: "white" }}>{entry.hours}</TableCell>
                  )}
                  <TableCell sx={{ color: "primary.light", fontWeight: 600 }}>
                    ${entry.grossPay.toFixed(2)}
                  </TableCell>
                  <TableCell sx={{ color: "success.light", fontWeight: 700 }}>
                    ${entry.netPay.toFixed(2)}
                  </TableCell>
                  <TableCell align="right">
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 1,
                      }}
                    >
                      <IconButton
                        size="small"
                        onClick={() => onEdit(entry)}
                        sx={{
                          color: "primary.light",
                          "&:hover": { bgcolor: "rgba(129, 140, 248, 0.1)" },
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => onDelete(entry.id)}
                        sx={{
                          color: "error.light",
                          "&:hover": { bgcolor: "rgba(248, 113, 113, 0.1)" },
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};
