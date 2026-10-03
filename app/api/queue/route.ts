// The old anonymous write API must not remain available after adding accounts.
export function GET() {
  return Response.json(
    { error: "Use the authenticated v2 API." },
    { status: 410 },
  );
}
export const POST = GET;
