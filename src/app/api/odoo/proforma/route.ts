import { NextRequest, NextResponse } from 'next/server';
import { legacyOdooRouteGuard } from '@/lib/auth/api-auth';
import { createProformaPdf, getInStockProformaProducts } from '@/lib/odoo/proforma';

export async function GET(request: NextRequest) {
  const authError = await legacyOdooRouteGuard(request);
  if (authError) return authError;

  try {
    const { requireAuthenticatedActor } = await import('@/lib/auth/api-auth');
    const actor = await requireAuthenticatedActor(request);
    const products = await getInStockProformaProducts();
    return NextResponse.json({ companyId: actor.currentCompanyId, products });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load products.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await legacyOdooRouteGuard(request);
  if (authError) return authError;

  try {
    const { requireAuthenticatedActor } = await import('@/lib/auth/api-auth');
    const actor = await requireAuthenticatedActor(request);
    const body = await request.json() as {
      companyId?: number;
      customerSearch?: string;
      customerId?: number;
      issueDate?: string;
      validityDays?: number;
      lines?: Array<{ productId: number; quantity: number; unitPrice: number }>;
    };
    if ((!body.customerSearch && !Number.isInteger(body.customerId)) || !Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: 'Select a customer and add at least one line.' }, { status: 400 });
    }
    const result = await createProformaPdf({
      companyId: actor.currentCompanyId,
      customerSearch: body.customerSearch ? String(body.customerSearch) : undefined,
      customerId: Number.isInteger(body.customerId) ? body.customerId : undefined,
      issueDate: body.issueDate,
      validityDays: Number(body.validityDays ?? 15),
      lines: body.lines.map((line) => ({
        productId: Number(line.productId),
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
      })),
    });

    return new NextResponse(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to generate PI PDF.' }, { status: 400 });
  }
}
