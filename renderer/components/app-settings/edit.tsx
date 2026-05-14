"use client";

import { useState, useMemo, useEffect } from "react";
import { useForm } from "@refinedev/react-hook-form";
import { COLORS } from "../../lib/constants";
import {
  Box,
  Typography,
  CircularProgress,
  Paper,
  Button,
  Slide,
} from "@mui/material";
import CircularProgressIcon from "@mui/material/CircularProgress";

import { W2Section } from "./sections/W2Section";

interface AppSettingsForm {
  w2Amount: number;
  wifeMonthlyAmount: number;
}

export const AppSettingsEdit = () => {
  const {
    refineCore: { onFinish, query: queryResult, formLoading },
    register,
    handleSubmit,
    watch,
    reset,
  } = useForm<AppSettingsForm>({
    refineCoreProps: {
      resource: "AppSettings",
      id: "global",
      action: "edit",
      redirect: false,
    },
    defaultValues: {
      w2Amount: 0,
      wifeMonthlyAmount: 0,
    },
  });

  const [isInitialized, setIsInitialized] = useState(false);
  const allValues = watch();

  useEffect(() => {
    if (queryResult?.data?.data) {
      reset(queryResult.data.data as AppSettingsForm);
      setIsInitialized(true);
    }
  }, [queryResult?.data?.data, reset]);

  const initialValues = useMemo(
    () => queryResult?.data?.data as AppSettingsForm | undefined,
    [queryResult?.data?.data],
  );

  const isDirty = useMemo(() => {
    if (!isInitialized || !initialValues || !allValues) return false;

    return (["w2Amount", "wifeMonthlyAmount"] as const).some((field) => {
      const curr = allValues[field] === "" || allValues[field] == null ? 0 : Number(allValues[field]);
      const init = initialValues[field] == null ? 0 : Number(initialValues[field]);
      return Math.abs(curr - init) > 0.0001;
    });
  }, [allValues, initialValues, isInitialized]);

  if (queryResult?.isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: "calc(100vh - 64px)",
        p: 3,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          width: "100%",
          maxWidth: 800,
          height: "100%",
          overflow: "hidden",
          backgroundColor: "#1e293b",
          borderRadius: 2,
          position: "relative",
          border: `1px solid ${COLORS.gross}33`,
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        }}
      >
        <Typography
          variant="overline"
          sx={{ display: "block", px: 4, pt: 3, color: "text.secondary", fontWeight: 700 }}
        >
          App Settings
        </Typography>

        <Box sx={{ p: 4, overflowY: "auto", height: "calc(100% - 48px)" }}>
          <form onSubmit={(e) => e.preventDefault()}>
            <W2Section register={register} />
          </form>
        </Box>

        <Slide direction="up" in={isDirty} mountOnEnter unmountOnExit>
          <Box
            sx={{
              position: "absolute",
              bottom: 24,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              zIndex: 1000,
              pointerEvents: "none",
            }}
          >
            <Paper
              sx={{
                p: "10px 16px",
                width: "calc(100% - 120px)",
                maxWidth: "800px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "#111214",
                borderRadius: "8px",
                boxShadow: "0 8px 16px rgba(0,0,0,0.4)",
                pointerEvents: "auto",
              }}
            >
              <Typography variant="body2" sx={{ color: "white", fontWeight: 600 }}>
                Careful — you have unsaved changes!
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Button
                  variant="text"
                  onClick={() => reset(initialValues)}
                  sx={{
                    color: "white",
                    textTransform: "none",
                    fontSize: "0.9rem",
                    "&:hover": { textDecoration: "underline", backgroundColor: "transparent" },
                  }}
                  disabled={formLoading}
                >
                  Reset
                </Button>
                <Button
                  variant="contained"
                  onClick={() => handleSubmit(onFinish)()}
                  disabled={formLoading}
                  startIcon={formLoading ? <CircularProgressIcon size={16} color="inherit" /> : null}
                  sx={{
                    backgroundColor: "#3DBC83",
                    color: "white",
                    textTransform: "none",
                    fontWeight: 600,
                    fontSize: "0.9rem",
                    px: 2,
                    py: 0.5,
                    "&:hover": { backgroundColor: "#1a7f45" },
                  }}
                >
                  {formLoading ? "Saving..." : "Save Changes"}
                </Button>
              </Box>
            </Paper>
          </Box>
        </Slide>
      </Box>
    </Box>
  );
};
