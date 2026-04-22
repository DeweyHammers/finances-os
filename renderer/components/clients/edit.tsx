"use client";

import { FC } from "react";
import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { ClientFormFields } from "./ClientFormFields";

interface ClientEditProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const ClientEdit: FC<ClientEditProps> = ({ modalProps }) => {
  return (
    <ResourceEditModal modalProps={modalProps} title="Client">
      <ClientFormFields formProps={modalProps} />
    </ResourceEditModal>
  );
};
