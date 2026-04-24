import { NextRequest, NextResponse } from "next/server";
import { getModel } from "../../../lib/prisma";

function transformBody(body: any) {
  const transformed = { ...body };
  Object.keys(transformed).forEach((key) => {
    const value = transformed[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      // Handle YYYY-MM-DD date format
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        transformed[key] = new Date(`${trimmed}T00:00:00Z`);
      }
      // Handle YYYY-MM-DDTHH:mm format from datetime-local
      else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
        transformed[key] = new Date(`${trimmed}:00Z`);
      } else {
        transformed[key] = trimmed;
      }
    }
  });
  return transformed;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const { resource } = await params;
  const searchParams = request.nextUrl.searchParams;

  const sortField = searchParams.get("_sort");
  const sortOrder = searchParams.get("_order")?.toLowerCase() || "asc";

  const model = getModel(resource);

  if (!model) {
    return NextResponse.json(
      { error: `Model ${resource} not found` },
      { status: 404 },
    );
  }

  try {
    const queryOptions: any = {
      where: {},
    };

    if (resource === "Client") {
      queryOptions.include = {
        contracts: true,
      };
    }

    if (resource === "Contract") {
      queryOptions.include = {
        entries: true,
        client: true,
      };
    }

    // Dynamic Filtering
    searchParams.forEach((value, key) => {
      // Skip known non-filter keys
      if (["_sort", "_order", "_start", "_end", "q"].includes(key)) return;

      if (key === "name" || key === "name_like") {
        queryOptions.where.name = {
          contains: value,
        };
      } else {
        // Handle basic equality for other fields
        queryOptions.where[key] = value;
      }
    });

    if (sortField) {
      const fields = sortField.split(",");
      const orders = sortOrder.split(",");

      const orderBy = fields
        .map((field, index) => {
          const trimmedField = field.trim();
          const order = (orders[index] || orders[0] || "asc")
            .trim()
            .toLowerCase();

          // Common virtual fields to exclude from Prisma orderBy
          const virtualFields = [
            "details",
            "activeContracts",
            "completedContracts",
            "actions",
            "action",
          ];

          if (virtualFields.includes(trimmedField)) {
            return null;
          }

          return { [trimmedField]: order };
        })
        .filter((item): item is { [key: string]: string } => item !== null);

      if (orderBy.length > 0) {
        queryOptions.orderBy = orderBy;
      }
    }

    const items = await model.findMany(queryOptions);
    const count = await model.count({ where: queryOptions.where });

    return new NextResponse(JSON.stringify(items), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-total-count": count.toString(),
        "Access-Control-Expose-Headers": "x-total-count",
      },
    });
  } catch (error: any) {
    console.error(`Error fetching ${resource}:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const { resource } = await params;
  let body = await request.json();

  const data = transformBody(body);

  const model = getModel(resource);

  if (!model) {
    return NextResponse.json(
      { error: `Model ${resource} not found` },
      { status: 404 },
    );
  }

  // Remove relation fields and potential extra fields
  const { client, contracts, ...createData } = data;

  if (resource === "Contract") {
    delete (createData as any).estimatedPayDate;

    // Ensure weeklyHours is an integer and not null
    createData.weeklyHours = createData.weeklyHours
      ? parseInt(createData.weeklyHours)
      : 0;

    if (createData.clientId) {
      (createData as any).client = {
        connect: { id: createData.clientId },
      };
      delete createData.clientId;
    }
  }

  if (resource === "ContractEntry") {
    if (createData.contractId) {
      (createData as any).contract = {
        connect: { id: createData.contractId },
      };
      delete createData.contractId;
    }
  }

  try {
    const item = await model.create({
      data: createData,
    });
    return NextResponse.json(item);
  } catch (error: any) {
    console.error(`Error creating ${resource}:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
