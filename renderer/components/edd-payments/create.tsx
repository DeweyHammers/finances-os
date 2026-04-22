"use client";

import { FC } from "react";
import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceCreateModal } from "../shared/ResourceCreateModal";
import { EddPaymentFormFields } from "./EddPaymentFormFields";

interface EddPaymentCreateProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const EddPaymentCreate: FC<EddPaymentCreateProps> = ({ modalProps }) => {
  return (
    <ResourceCreateModal modalProps={modalProps} title="EDD Payment">
      <EddPaymentFormFields formProps={modalProps} />
    </ResourceCreateModal>
  );
};
