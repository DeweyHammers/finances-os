import {
  Box,
  Typography,
  Paper,
  Grid,
  TextField,
  InputAdornment,
  FormControlLabel,
  Switch,
  IconButton,
  Button,
} from "@mui/material";
import ExtensionIcon from "@mui/icons-material/Extension";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";

interface HourlyJob {
  id: string;
  rate: number | "";
  hoursPerWeek: number | "";
  isSecured: boolean;
}

interface HourlyJobsSectionProps {
  hourlyJobs: HourlyJob[];
  addHourlyJob: () => void;
  removeHourlyJob: (id: string) => void;
  updateHourlyJob: (id: string, field: keyof HourlyJob, value: any) => void;
  formatCurrency: (val: number) => string;
}

export default function HourlyJobsSection({
  hourlyJobs,
  addHourlyJob,
  removeHourlyJob,
  updateHourlyJob,
  formatCurrency,
}: HourlyJobsSectionProps) {
  return (
    <Paper
      sx={{
        p: 3,
        borderRadius: 2,
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <Box
        sx={{
          mb: 2,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography
          variant="h6"
          sx={{
            color: "primary.main",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <ExtensionIcon fontSize="small" /> Hourly Jobs Pipeline
        </Typography>
        <Button
          startIcon={<AddIcon />}
          onClick={addHourlyJob}
          variant="outlined"
          size="small"
          sx={{ borderRadius: 2 }}
        >
          Add Job
        </Button>
      </Box>
      {hourlyJobs.length === 0 ? (
        <Box
          sx={{
            py: 4,
            textAlign: "center",
            bgcolor: "rgba(0,0,0,0.1)",
            borderRadius: 2,
            border: "1px dashed rgba(255,255,255,0.1)",
          }}
        >
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            No hourly jobs added yet.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {hourlyJobs.map((job) => (
            <Paper
              key={job.id}
              sx={{
                p: 2,
                bgcolor: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <Grid container spacing={2} sx={{ alignItems: "center" }}>
                <Grid size={{ xs: 4 }}>
                  <TextField
                    label="Rate"
                    type="number"
                    size="small"
                    fullWidth
                    value={job.rate}
                    onChange={(e) =>
                      updateHourlyJob(
                        job.id,
                        "rate",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">$</InputAdornment>
                        ),
                      },
                    }}
                  />
                </Grid>
                <Grid size={{ xs: 3 }}>
                  <TextField
                    label="Hrs/Wk"
                    type="number"
                    size="small"
                    fullWidth
                    value={job.hoursPerWeek}
                    onChange={(e) =>
                      updateHourlyJob(
                        job.id,
                        "hoursPerWeek",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </Grid>
                <Grid size={{ xs: 3 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={job.isSecured}
                        onChange={(e) =>
                          updateHourlyJob(job.id, "isSecured", e.target.checked)
                        }
                      />
                    }
                    label={<Typography variant="caption">Secured</Typography>}
                  />
                </Grid>
                <Grid size={{ xs: 2 }} sx={{ textAlign: "right" }}>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => removeHourlyJob(job.id)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", ml: 1 }}
                  >
                    Est. Monthly: $
                    {formatCurrency(
                      (Number(job.rate) || 0) *
                        (Number(job.hoursPerWeek) || 0) *
                        4,
                    )}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          ))}
        </Box>
      )}
    </Paper>
  );
}
