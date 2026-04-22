"use client";

import { useState, useMemo, useEffect } from "react";
import { useForm } from "@refinedev/react-hook-form";
import { COLORS } from "../../lib/constants";
import {
  Box,
  Typography,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Button,
  Slide,
} from "@mui/material";
import HistoryEduIcon from "@mui/icons-material/HistoryEdu";
import WorkIcon from "@mui/icons-material/Work";
import BusinessIcon from "@mui/icons-material/Business";
import SettingsIcon from "@mui/icons-material/Settings";
import CircularProgressIcon from "@mui/material/CircularProgress";

// Sub-components
import { GeneralSection } from "./sections/GeneralSection";
import { W2Section } from "./sections/W2Section";
import { EddSection } from "./sections/EddSection";
import { UpWorkSection } from "./sections/UpWorkSection";

interface AppSettingsForm {
  paymentCycle: string;
  eddActive: boolean;
  eddRemainingBalance: number;
  baseEddWeeklyAmount: number;
  w2Active: boolean;
  w2Amount: number;
  upworkActive: boolean;
  upworkTaxProvisionPercent: number;
  upworkExpensesHoldActive: boolean;
  upworkExpensesHoldAmount: number;
  upworkMinWithdrawalAmount: number;
  wifeMonthlyAmount: number;
}

export const AppSettingsEdit = () => {
  const {
    refineCore: { onFinish, query: queryResult, formLoading },
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
  } = useForm<AppSettingsForm>({
    refineCoreProps: {
      resource: "AppSettings",
      id: "global",
      action: "edit",
      redirect: false,
    },
    defaultValues: {
      paymentCycle: "BI_WEEKLY",
      eddActive: true,
      eddRemainingBalance: 0,
      baseEddWeeklyAmount: 0,
      w2Active: false,
      w2Amount: 0,
      upworkActive: true,
      upworkTaxProvisionPercent: 0.25,
      upworkExpensesHoldActive: false,
      upworkExpensesHoldAmount: 0,
      upworkMinWithdrawalAmount: 0,
      wifeMonthlyAmount: 0,
    },
  });

  const [activeSection, setActiveSection] = useState("general");
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

    // Check text/numeric/select fields
    const textFields: (keyof AppSettingsForm)[] = [
      "paymentCycle",
      "w2Amount",
      "baseEddWeeklyAmount",
      "eddRemainingBalance",
      "upworkTaxProvisionPercent",
      "upworkMinWithdrawalAmount",
      "upworkExpensesHoldAmount",
      "wifeMonthlyAmount",
    ];
    const textDirty = textFields.some((field) => {
      const current = allValues[field];
      const initial = initialValues[field];

      if (field === "paymentCycle") return current !== initial;

      const currNum =
        current === "" || current === null || current === undefined
          ? 0
          : Number(current);
      const initNum =
        initial === "" || initial === null || initial === undefined
          ? 0
          : Number(initial);
      return Math.abs(currNum - initNum) > 0.0001;
    });

    // Check boolean switches
    const booleanFields: (keyof AppSettingsForm)[] = [
      "w2Active",
      "eddActive",
      "upworkActive",
      "upworkExpensesHoldActive",
    ];
    const booleanDirty = booleanFields.some(
      (field) => !!allValues[field] !== !!initialValues[field],
    );

    return textDirty || booleanDirty;
  }, [allValues, initialValues, isInitialized]);

  const handleToggleChange = (name: string, checked: boolean) => {
    setValue(name as any, checked, { shouldDirty: true });
  };

  const handleManualSave = () => {
    handleSubmit(onFinish)();
  };

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
          display: "flex",
          width: "100%",
          maxWidth: 1600,
          height: "100%",
          overflow: "hidden",
          backgroundColor: "#1e293b",
          borderRadius: 2,
          position: "relative",
          border: `1px solid ${COLORS.gross}33`, // Added opacity
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        }}
      >
        {/* Sidebar */}
        <Box
          sx={{
            width: 240,
            backgroundColor: "#0f172a",
            borderRight: "1px solid rgba(255, 255, 255, 0.05)",
            display: "flex",
            flexDirection: "column",
            pt: 4,
          }}
        >
          <Typography
            variant="overline"
            sx={{ px: 3, mb: 1, color: "text.secondary", fontWeight: 700 }}
          >
            App Settings
          </Typography>
          <List sx={{ px: 1, flex: 1 }}>
            {[
              { id: "general", label: "General", icon: <SettingsIcon /> },
              { id: "w2", label: "W2", icon: <WorkIcon /> },
              { id: "edd", label: "EDD", icon: <HistoryEduIcon /> },
              { id: "upwork", label: "UpWork", icon: <BusinessIcon /> },
            ].map((item) => (
              <ListItem key={item.id} disablePadding sx={{ mb: 0.5 }}>
                <ListItemButton
                  selected={activeSection === item.id}
                  onClick={() => setActiveSection(item.id)}
                  sx={{
                    borderRadius: 1,
                    mx: 1,
                    "&.Mui-selected": {
                      backgroundColor: `${COLORS.gross}26`,
                      color: COLORS.gross,
                      "& .MuiListItemIcon-root": { color: COLORS.gross },
                      "&:hover": {
                        backgroundColor: `${COLORS.gross}33`,
                      },
                    },
                    "&:hover": {
                      backgroundColor: "rgba(255, 255, 255, 0.04)",
                    },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 40,
                      color:
                        activeSection === item.id
                          ? COLORS.gross
                          : "text.secondary",
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography
                        sx={{
                          fontSize: "0.9rem",
                          fontWeight: activeSection === item.id ? 700 : 500,
                          color:
                            activeSection === item.id ? COLORS.gross : "#94a3b8",
                        }}
                      >
                        {item.label}
                      </Typography>
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, p: 6, overflowY: "auto" }}>
          <form onSubmit={(e) => e.preventDefault()}>
            {activeSection === "general" && (
              <GeneralSection
                register={register}
                currentValue={allValues.paymentCycle}
                initialValue={initialValues?.paymentCycle}
              />
            )}
            {activeSection === "w2" && (
              <W2Section
                register={register}
                w2Active={!!allValues.w2Active}
                paymentCycle={allValues.paymentCycle}
                onToggleChange={handleToggleChange}
              />
            )}

            {activeSection === "edd" && (
              <EddSection
                register={register}
                eddActive={!!allValues.eddActive}
                onToggleChange={handleToggleChange}
              />
            )}
            {activeSection === "upwork" && (
              <UpWorkSection
                register={register}
                upworkActive={!!allValues.upworkActive}
                upworkExpensesHoldActive={!!allValues.upworkExpensesHoldActive}
                onToggleChange={handleToggleChange}
              />
            )}
          </form>
        </Box>

        {/* Floating Save Bar */}
        <Slide direction="up" in={isDirty} mountOnEnter unmountOnExit>
          <Box
            sx={{
              position: "absolute",
              bottom: 24,
              left: "240px",
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
              <Typography
                variant="body2"
                sx={{ color: "white", fontWeight: 600 }}
              >
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
                    "&:hover": {
                      textDecoration: "underline",
                      backgroundColor: "transparent",
                    },
                  }}
                  disabled={formLoading}
                >
                  Reset
                </Button>
                <Button
                  variant="contained"
                  onClick={handleManualSave}
                  disabled={formLoading}
                  startIcon={
                    formLoading ? (
                      <CircularProgressIcon size={16} color="inherit" />
                    ) : null
                  }
                  sx={{
                    backgroundColor: "#23a559",
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
