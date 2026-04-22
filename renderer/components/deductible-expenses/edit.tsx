"use client";

import { UseFormRegister } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { DeductibleExpenseFormFields } from "./DeductibleExpenseFormFields";

export const DeductibleExpenseEdit = (props: any) => {
  return (
    <ResourceEditModal
      {...props}
      title="Edit Deductible Expense"
      resource="DeductibleExpense"
    >
      {(register: UseFormRegister<any>) => (
        <DeductibleExpenseFormFields register={register} />
      )}
    </ResourceEditModal>
  );
};
