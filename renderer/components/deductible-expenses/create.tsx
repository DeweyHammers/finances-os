"use client";

import { UseFormRegister } from "react-hook-form";
import { ResourceCreateModal } from "../shared/ResourceCreateModal";
import { DeductibleExpenseFormFields } from "./DeductibleExpenseFormFields";

export const DeductibleExpenseCreate = (props: any) => {
  return (
    <ResourceCreateModal
      {...props}
      title="UpWork Deductible Expense"
      resource="DeductibleExpense"
    >
      {(register: UseFormRegister<any>) => (
        <DeductibleExpenseFormFields register={register} />
      )}
    </ResourceCreateModal>
  );
};
