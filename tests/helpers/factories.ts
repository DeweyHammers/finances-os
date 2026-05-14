let counter = 0;
const nextId = () => `test-${++counter}`;

export const makeAccount = (overrides: Partial<any> = {}) => ({
  id: nextId(),
  name: "Checking",
  notes: null,
  closed: false,
  sortOrder: 0,
  ...overrides,
});

export const makeTransaction = (overrides: Partial<any> = {}) => ({
  id: nextId(),
  accountId: "acc-1",
  date: new Date("2026-05-15T00:00:00Z").toISOString(),
  payeeId: null,
  categoryItemId: null,
  memo: null,
  inflowCents: 0,
  outflowCents: 0,
  isAdjustment: false,
  cleared: true,
  ...overrides,
});

export const makeCategoryItem = (overrides: Partial<any> = {}) => ({
  id: nextId(),
  groupId: "grp-1",
  name: "Item",
  sortOrder: 0,
  sourceType: "CUSTOM",
  sourceBillId: null,
  sourcePersonalName: null,
  customAmountCents: null,
  customCycle: null,
  ...overrides,
});

export const makeBudgetMonth = (overrides: Partial<any> = {}) => ({
  id: nextId(),
  month: new Date(Date.UTC(2026, 4, 1)).toISOString(),
  categoryItemId: "item-1",
  assignedCents: 0,
  ...overrides,
});

export const makeBill = (overrides: Partial<any> = {}) => ({
  id: nextId(),
  name: "Netflix",
  amount: 26.99,
  dueDate: 28,
  withdrawalCycle: "Q4",
  isAutoPay: true,
  ...overrides,
});

export const makePersonal = (overrides: Partial<any> = {}) => ({
  id: nextId(),
  name: "Gas",
  amount: 50,
  dueDate: 1,
  withdrawalCycle: "Q1",
  ...overrides,
});
