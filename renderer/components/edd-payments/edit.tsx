"use client";

import { FC } from "react";
import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { EddPaymentFormFields } from "./EddPaymentFormFields";

interface EddPaymentEditProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const EddPaymentEdit: FC<EddPaymentEditProps> = ({ modalProps }) => {
  return (
    <ResourceEditModal modalProps={modalProps} title="EDD Payment">
      <EddPaymentFormFields formProps={modalProps} />
    </ResourceEditModal>
  );
};
