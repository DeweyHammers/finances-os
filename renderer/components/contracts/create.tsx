"use client";

import { FC } from "react";
import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceCreateModal } from "../shared/ResourceCreateModal";
import { ContractFormFields } from "./ContractFormFields";

interface ContractCreateProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const ContractCreate: FC<ContractCreateProps> = ({ modalProps }) => {
  return (
    <ResourceCreateModal modalProps={modalProps} title="Contract" maxWidth="md">
      <ContractFormFields formProps={modalProps as any} />
    </ResourceCreateModal>
  );
};
