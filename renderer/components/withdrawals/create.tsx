"use client";

import { UseFormRegister } from "react-hook-form";
import { ResourceCreateModal } from "../shared/ResourceCreateModal";
import { WithdrawalFormFields } from "./WithdrawalFormFields";

export const WithdrawalCreate = (props: any) => {
  return (
    <ResourceCreateModal
      {...props}
      title="UpWork Withdrawal"
      resource="Withdrawal"
    >
      {(register: UseFormRegister<any>) => (
        <WithdrawalFormFields register={register} />
      )}
    </ResourceCreateModal>
  );
};
