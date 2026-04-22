"use client";

import { FC } from "react";
import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceCreateModal } from "../shared/ResourceCreateModal";
import { ClientFormFields } from "./ClientFormFields";

interface ClientCreateProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const ClientCreate: FC<ClientCreateProps> = ({ modalProps }) => {
  return (
    <ResourceCreateModal modalProps={modalProps} title="Client">
      <ClientFormFields formProps={modalProps} />
    </ResourceCreateModal>
  );
};
