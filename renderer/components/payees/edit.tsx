"use client";

import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { PayeeFormFields } from "./PayeeFormFields";

interface PayeeEditProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const PayeeEdit = ({ modalProps }: PayeeEditProps) => {
  return (
    <ResourceEditModal modalProps={modalProps} title="Payee">
      <PayeeFormFields formProps={modalProps} />
    </ResourceEditModal>
  );
};
