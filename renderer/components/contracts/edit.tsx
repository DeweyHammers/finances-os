"use client";

import { FC } from "react";
import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { ContractFormFields } from "./ContractFormFields";

interface ContractEditProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const ContractEdit: FC<ContractEditProps> = ({ modalProps }) => {
  return (
    <ResourceEditModal modalProps={modalProps} title="Contract" maxWidth="md">
      <ContractFormFields formProps={modalProps as any} />
    </ResourceEditModal>
  );
};
