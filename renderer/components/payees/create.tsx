"use client";

/**
 * PayeeCreate — Refine create-modal wrapper for the Payee resource.
 *
 * Rare in practice: most payees are created ad hoc via PayeeAutocomplete's
 * freeSolo path. This modal exists mainly for renames-via-delete-and-create.
 */

import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceCreateModal } from "../shared/ResourceCreateModal";
import { PayeeFormFields } from "./PayeeFormFields";

interface PayeeCreateProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const PayeeCreate = ({ modalProps }: PayeeCreateProps) => {
  return (
    <ResourceCreateModal modalProps={modalProps} title="Payee">
      <PayeeFormFields formProps={modalProps} />
    </ResourceCreateModal>
  );
};
