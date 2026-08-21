import { NextRequest, NextResponse } from 'next/server';
import { getOdooConfig, OdooApiError, odooFetch } from '@/lib/odoo/client';
import { legacyOdooRouteGuard } from '@/lib/auth/api-auth';

interface InvoicePdfAccess {
  id: number;
  name: string;
  state: string;
  access_token: string | false;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = await legacyOdooRouteGuard(request);
  if (authError) return authError;
  const { id } = await context.params;
  const invoiceId = parseInt(id, 10);

  if (isNaN(invoiceId)) {
    return NextResponse.json({ error: 'Invalid invoice ID' }, { status: 400 });
  }

  try {
    // The report controller requires a browser session and does not accept a
    // JSON-2 API key. Use the invoice's server-side portal token instead.
    const invoices = await odooFetch<InvoicePdfAccess[]>(
      'account.move',
      'search_read',
      [['id', '=', invoiceId]],
      ['id', 'name', 'state', 'access_token'],
      { limit: 1 }
    );

    const invoice = invoices[0];
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (invoice.state !== 'posted') {
      return NextResponse.json(
        { error: 'Only posted invoices can be rendered as PDF' },
        { status: 409 }
      );
    }

    if (!invoice.access_token) {
      return NextResponse.json(
        { error: 'The invoice does not have a portal access token' },
        { status: 409 }
      );
    }

    const { baseUrl } = getOdooConfig();
    const odooBase = baseUrl.replace(/\/json\/2$/, '');
    const reportUrl = new URL(`/my/invoices/${invoiceId}`, odooBase);
    reportUrl.searchParams.set('access_token', invoice.access_token);
    reportUrl.searchParams.set('report_type', 'pdf');

    const res = await fetch(reportUrl, {
      cache: 'no-store',
      redirect: 'manual',
    });

    const contentType = res.headers.get('content-type') ?? '';

    if (res.ok && contentType.includes('application/pdf')) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const { searchParams } = new URL(request.url);
      const download = searchParams.get('download') === 'true';
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="invoice-${invoiceId}.pdf"`,
          'Content-Length': buffer.length.toString(),
          'Cache-Control': 'private, max-age=300',
        },
      });
    }

    // Not a PDF — log what came back for debugging
    // Do not return an Odoo HTML page inside the PDF iframe.
    console.error(`invoice-pdf: unexpected response ${res.status} ${contentType}`);
    return NextResponse.json(
      { error: `Odoo returned ${res.status} instead of a PDF`, contentType },
      { status: res.status === 429 ? 429 : 502 }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown invoice PDF error';
    console.error('Invoice PDF proxy error:', e);
    return NextResponse.json(
      { error: message },
      { status: e instanceof OdooApiError && e.code === 429 ? 429 : 500 },
    );
  }
}
