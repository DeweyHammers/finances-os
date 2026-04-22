"use client";

import { UseFormRegister } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { WithdrawalFormFields } from "./WithdrawalFormFields";

export const WithdrawalEdit = (props: any) => {
  return (
    <ResourceEditModal {...props} title="Edit Withdrawal" resource="Withdrawal">
      {(register: UseFormRegister<any>) => (
        <WithdrawalFormFields register={register} />
      )}
    </ResourceEditModal>
  );
};
