import express, { Request, Response, NextFunction } from "express";
import { getModel, prisma } from "../shared/prisma";

const app = express();
app.use(express.json());

// CORS for development
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  res.header("Access-Control-Allow-Headers", "Content-Type, x-total-count");
  res.header("Access-Control-Expose-Headers", "x-total-count");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

export function transformBody(body: any) {
  const transformed = { ...body };
  Object.keys(transformed).forEach((key) => {
    const value = transformed[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        transformed[key] = new Date(`${trimmed}T00:00:00Z`);
      } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
        transformed[key] = new Date(`${trimmed}:00Z`);
      } else if (
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(trimmed)
      ) {
        transformed[key] = new Date(trimmed);
      } else if (
        (trimmed !== "" &&
          !isNaN(Number(trimmed)) &&
          !trimmed.startsWith("0")) ||
        trimmed === "0"
      ) {
        // Only convert to number if it's a valid number and doesn't have leading zeros (unless it's just "0")
        // This avoids converting IDs that might be numeric strings
        if (
          key === "amount" ||
          key === "dueDate" ||
          key === "grossPay" ||
          key === "netPay" ||
          key === "hours" ||
          key === "weeklyHours" ||
          key === "month" ||
          key === "day" ||
          key === "inflowCents" ||
          key === "outflowCents" ||
          key === "customAmountCents" ||
          key === "assignedCents" ||
          key === "sortOrder"
        ) {
          const num = Number(trimmed);
          if (!isNaN(num)) {
            transformed[key] = num;
          }
        } else {
          transformed[key] = trimmed;
        }
      } else {
        transformed[key] = trimmed;
      }
    }
  });
  return transformed;
}

// List & Create
app.get("/api/:resource", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  const searchParams = req.query as any;

  const model = getModel(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  try {
    const queryOptions: any = { where: {} };

  
    Object.keys(searchParams).forEach((key) => {
      const value = searchParams[key];
      if (["_sort", "_order", "_start", "_end", "q"].includes(key)) return;

      if (key.endsWith("_like")) {
        const fieldName = key.slice(0, -5);
        queryOptions.where[fieldName] = { contains: value };
      } else {
        queryOptions.where[key] = value;
      }
    });

    if (searchParams._sort) {
      const sortStr = searchParams._sort.toString();
      const fields = sortStr.split(",");
      const order = (searchParams._order || "asc").toString().toLowerCase();
      queryOptions.orderBy = fields.map((f: string) => ({ [f.trim()]: order }));
    }

    const items = await model.findMany(queryOptions);
    const count = await model.count({ where: queryOptions.where });

    res.header("x-total-count", count.toString());
    res.json(items);
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/:resource", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  console.log(`POST /api/${resource} - Body:`, JSON.stringify(req.body));
  const data = transformBody(req.body);
  const model = getModel(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  const { client, contracts, id, ...createData } = data;

  // Strip fields that don't exist in certain models but might be sent by the frontend
  console.log(`Creating ${resource} with data:`, JSON.stringify(createData));

  try {
    const item = await model.create({ data: createData });
    res.json(item);
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({
      error: error.message,
      stack: error.stack,
      details: error,
    });
  }
});

// Show, Update, Delete
app.get("/api/:resource/:id", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  const id = req.params.id as string;
  const model = getModel(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  try {
    const queryOptions: any = { where: { id } };

    const item = await model.findUnique(queryOptions);
    if (!item) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(item);
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/:resource/:id", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  const id = req.params.id as string;
  console.log(`PATCH /api/${resource}/${id} - Body:`, JSON.stringify(req.body));
  const data = transformBody(req.body);
  const model = getModel(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  const { client, contracts, entries, id: _id, ...updateData } = data;

  try {
    const item = await model.update({ where: { id }, data: updateData });
    res.json(item);
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({
      error: error.message,
      stack: error.stack,
      details: error,
    });
  }
});

app.delete("/api/:resource/:id", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  const id = req.params.id as string;
  const model = getModel(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  try {
    if (resource === "BudgetCategoryItem") {
      // Snapshot the item's name onto every transaction that referenced it
      // so the historical category stays visible after the relation is severed.
      const item = await prisma.budgetCategoryItem.findUnique({
        where: { id },
        select: { name: true },
      });
      if (item) {
        await prisma.accountTransaction.updateMany({
          where: { categoryItemId: id },
          data: { categoryName: item.name },
        });
      }
    }

    await model.delete({ where: { id } });
    res.json({ success: true });
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({ error: error.message });
  }
});

export function startServer(port = 5858) {
  return app.listen(port, () => {
    console.log(`API Server running on port ${port}`);
  });
}
