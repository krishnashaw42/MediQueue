import { NextRequest, NextResponse } from "next/server";
import { getStore, QueueError } from "../../../lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Something went wrong.",
    },
    {
      status: error instanceof QueueError ? error.status : 400,
    },
  );
}

export async function GET(request: NextRequest) {
  try {
    const queue = getStore();
    const params = request.nextUrl.searchParams;

    let result;

    if (params.has("token")) {
      result = queue.track(params.get("token")!);
    } else if (params.get("view") === "board") {
      result = queue.board();
    } else {
      result = queue.snapshot();
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object") {
      throw new QueueError("Invalid request.", 400);
    }

    const queue = getStore();
    let result;

    switch (body.action) {
      case "join":
        result = queue.join(body);
        break;

      case "counter":
        result = queue.action(
          body.serviceId,
          body.operation,
          body.tokenId,
        );
        break;

      case "cancel":
        result = queue.cancel(body.tokenId);
        break;

      case "service":
        result = queue.setService(body.serviceId, body.status);
        break;

      case "reset":
        if (body.confirmation !== "RESET") {
          throw new QueueError("Reset confirmation is required.", 400);
        }

        queue.reset();
        result = { success: true };
        break;

      default:
        throw new QueueError("Unknown operation.", 400);
    }

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}