"use client";

/**
 * PayeeAutocomplete — free-solo Payee picker used across transaction entry forms.
 *
 * Behaviour:
 *   - Loads all Payees once (pagination off) so users can search by prefix in a small list.
 *   - Emits the selected Payee's id via onChange (not the name — transactions FK on id).
 *   - freeSolo: typing a new name and blurring/submitting silently POSTs a new Payee
 *     and then emits the newly-created id. Case-insensitive dedupe against existing rows.
 *   - onCreatingChange is an optional signal the parent form can use to disable Save
 *     while a background create is in flight (prevents saving with a stale null id).
 */

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
  // pagination: "off" pulls the whole payee table in one shot — fine because the
  // dataset is tiny (personal finance app, dozens of payees at most).
  const { query } = useList<PayeeOption>({
    resource: "Payee",
    pagination: { mode: "off" },
  });
  const { mutate: createPayee } = useCreate();
  // Tracked separately from useCreate's own state so we can bubble it to the parent
  // form via onCreatingChange (parent uses this to gate submit).
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

  // MUI Autocomplete calls this with THREE distinct shapes:
  //   - null    → user cleared the field
  //   - string  → freeSolo typed value (either onBlur or Enter with no dropdown match)
  //   - object  → user picked an existing PayeeOption from the dropdown
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

      // Case-insensitive dedupe so "Amazon" and "amazon" collapse to the same Payee row.
      const existing = payees.find(
        (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) {
        onChange(existing.id);
        return;
      }

      // No match — silently POST a new Payee. Suppress the default Refine toast:
      // this is background housekeeping the user shouldn't have to acknowledge.
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
          // On failure we still release the creating flag so the parent form doesn't
          // stay disabled forever. The blank payee just leaves the field empty.
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
        // Blur-to-create: if the user typed a name and clicked away without pressing
        // Enter, treat it as a freeSolo submission so the payee still gets created.
        // Guarded by !selected so blurring a picked option is a no-op.
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
