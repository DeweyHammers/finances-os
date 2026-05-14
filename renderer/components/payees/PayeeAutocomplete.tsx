"use client";

import { useState, useMemo } from "react";
import { Autocomplete, TextField } from "@mui/material";
import { useList, useCreate } from "@refinedev/core";

interface PayeeOption {
  id: string;
  name: string;
}

interface PayeeAutocompleteProps {
  value: string | null;
  onChange: (payeeId: string | null) => void;
  onCreatingChange?: (creating: boolean) => void;
  label?: string;
  size?: "small" | "medium";
}

export const PayeeAutocomplete = ({
  value,
  onChange,
  onCreatingChange,
  label = "Payee",
  size = "medium",
}: PayeeAutocompleteProps) => {
  const { query } = useList<PayeeOption>({
    resource: "Payee",
    pagination: { mode: "off" },
  });
  const { mutate: createPayee } = useCreate();
  const [isCreating, setIsCreating] = useState(false);

  const payees = useMemo<PayeeOption[]>(
    () => (query.data?.data || []) as any,
    [query.data?.data],
  );

  const selected = useMemo(
    () => payees.find((p) => p.id === value) || null,
    [payees, value],
  );

  const setCreating = (v: boolean) => {
    setIsCreating(v);
    onCreatingChange?.(v);
  };

  const handleChange = (
    _: any,
    next: PayeeOption | string | null,
  ) => {
    if (next == null) {
      onChange(null);
      return;
    }

    if (typeof next === "string") {
      const trimmed = next.trim();
      if (!trimmed) {
        onChange(null);
        return;
      }

      const existing = payees.find(
        (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) {
        onChange(existing.id);
        return;
      }

      setCreating(true);
      createPayee(
        {
          resource: "Payee",
          values: { name: trimmed },
          successNotification: false,
        },
        {
          onSuccess: (created) => {
            const id = (created as any)?.data?.id;
            if (id) onChange(id);
            setCreating(false);
          },
          onError: () => setCreating(false),
        },
      );
      return;
    }

    onChange(next.id);
  };

  return (
    <Autocomplete
      freeSolo
      size={size}
      value={selected}
      options={payees}
      getOptionLabel={(opt) =>
        typeof opt === "string" ? opt : opt?.name || ""
      }
      isOptionEqualToValue={(opt, v) =>
        typeof opt !== "string" && typeof v !== "string" && opt.id === v.id
      }
      onChange={handleChange}
      onBlur={(e) => {
        const text = (e.target as HTMLInputElement).value?.trim();
        if (text && !selected) handleChange(null, text);
      }}
      loading={query.isLoading || isCreating}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          variant="outlined"
          slotProps={{
            ...(params as any).slotProps,
            inputLabel: { shrink: true },
          }}
        />
      )}
    />
  );
};
