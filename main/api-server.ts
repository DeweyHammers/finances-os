import express, { Request, Response, NextFunction } from "express";
import { getModel } from "../shared/prisma";

const app = express();
app.use(express.json());

// CORS for development
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, x-total-count");
  res.header("Access-Control-Expose-Headers", "x-total-count");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

function transformBody(body: any) {
  const transformed = { ...body };
  Object.keys(transformed).forEach((key) => {
    const value = transformed[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        transformed[key] = new Date(`${trimmed}T00:00:00Z`);
      } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
        transformed[key] = new Date(`${trimmed}:00Z`);
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

    if (resource === "Client") queryOptions.include = { contracts: true };
    if (resource === "Contract")
      queryOptions.include = { entries: true, client: true };

    Object.keys(searchParams).forEach((key) => {
      const value = searchParams[key];
      if (["_sort", "_order", "_start", "_end", "q"].includes(key)) return;

      if (key === "name" || key === "name_like") {
        queryOptions.where.name = { contains: value };
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
  const data = transformBody(req.body);
  const model = getModel(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  const { client, contracts, ...createData } = data;

  if (resource === "Contract") {
    delete (createData as any).estimatedPayDate;
    createData.weeklyHours = createData.weeklyHours
      ? parseInt(createData.weeklyHours)
      : 0;
    if (createData.clientId) {
      (createData as any).client = { connect: { id: createData.clientId } };
      delete createData.clientId;
    }
  }

  if (resource === "ContractEntry" && createData.contractId) {
    (createData as any).contract = { connect: { id: createData.contractId } };
    delete createData.contractId;
  }

  try {
    const item = await model.create({ data: createData });
    res.json(item);
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({ error: error.message });
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
    if (resource === "Client") queryOptions.include = { contracts: true };
    if (resource === "Contract")
      queryOptions.include = {
        entries: { orderBy: { date: "desc" } },
        client: true,
      };

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
  const data = transformBody(req.body);
  const model = getModel(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  const { client, contracts, entries, ...updateData } = data;

  try {
    const item = await model.update({ where: { id }, data: updateData });
    res.json(item);
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({ error: error.message });
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
    await model.delete({ where: { id } });
    res.json({ success: true });
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({ error: error.message });
  }
});

export function startServer(port = 8888) {
  return app.listen(port, () => {
    console.log(`API Server running on port ${port}`);
  });
}
