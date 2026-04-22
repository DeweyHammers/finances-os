import { NextRequest, NextResponse } from "next/server";
import { getModel } from "../../../../lib/prisma";

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
  _request: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await params;
  const model = getModel(resource);

  if (!model) {
    return NextResponse.json(
      { error: `Model ${resource} not found` },
      { status: 404 },
    );
  }

  try {
    const queryOptions: any = {
      where: { id },
    };

    if (resource === "Contract") {
      queryOptions.include = {
        entries: {
          orderBy: { date: "desc" },
        },
        client: true,
      };
    }

    const item = await model.findUnique(queryOptions);

    if (!item) {
      return NextResponse.json(
        { error: `${resource} with id ${id} not found` },
        { status: 404 },
      );
    }

    return NextResponse.json(item);
  } catch (error: any) {
    console.error(`Error fetching ${resource} with id ${id}:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await params;
  let body = await request.json();

  const data = transformBody(body);

  const model = getModel(resource);

  if (!model) {
    return NextResponse.json(
      { error: `Model ${resource} not found` },
      { status: 404 },
    );
  }

  // Remove relation fields and id from data to prevent Prisma errors
  const {
    client,
    contracts,
    plannedBlocks,
    entries,
    blocks,
    id: _,
    ...updateData
  } = data;

  // Handle Contract specific logic
  if (resource === "Contract") {
    delete (updateData as any).estimatedPayDate;
    if (updateData.clientId) {
      (updateData as any).client = {
        connect: { id: updateData.clientId },
      };
      delete updateData.clientId;
    }
  }

  if (resource === "PlannedBlock") {
    // If contractId is empty string, make it null
    if (updateData.contractId === "") {
      updateData.contractId = null;
    }
  }

  try {
    const item = await model.update({
      where: { id },
      data: updateData,
    });
    return NextResponse.json(item);
  } catch (error: any) {
    console.error(`Error updating ${resource} with id ${id}:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await params;
  const model = getModel(resource);

  if (!model) {
    return NextResponse.json(
      { error: `Model ${resource} not found` },
      { status: 404 },
    );
  }

  try {
    await model.delete({
      where: { id },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(`Error deleting ${resource} with id ${id}:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
