"use client";

import { styled } from "@mui/material/styles";
import { Switch as MuiSwitch } from "@mui/material";

export const AppSwitch = styled(MuiSwitch)(({ theme }) => ({
  width: 42,
  height: 24,
  padding: 0,
  "& .MuiSwitch-switchBase": {
    padding: 0,
    margin: 3,
    transitionDuration: "200ms",
    "&.Mui-checked": {
      transform: "translateX(18px)",
      color: "#fff",
      "& + .MuiSwitch-track": {
        backgroundColor: "#23a559",
        opacity: 1,
        border: 0,
      },
      "&.Mui-disabled + .MuiSwitch-track": {
        opacity: 0.5,
      },
    },
    "&.Mui-disabled .MuiSwitch-thumb": {
      color: "#f6f6f6",
    },
    "&.Mui-disabled + .MuiSwitch-track": {
      opacity: 0.3,
    },
  },
  "& .MuiSwitch-thumb": {
    boxSizing: "border-box",
    width: 18,
    height: 18,
    boxShadow: "none",
  },
  "& .MuiSwitch-track": {
    borderRadius: 12,
    backgroundColor: "#80848e",
    opacity: 1,
    transition: theme.transitions.create(["background-color"], {
      duration: 200,
    }),
  },
  "& .MuiTouchRipple-root": {
    display: "none",
  },
}));
