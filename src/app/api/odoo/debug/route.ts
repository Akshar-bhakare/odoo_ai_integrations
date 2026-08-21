import { NextRequest, NextResponse } from 'next/server';
import { odooFetch, getOdooConfig } from '@/lib/odoo/client';
import { legacyOdooRouteGuard } from '@/lib/auth/api-auth';

interface DebugOrder {
  id: number;
  name: string;
  invoice_ids: number[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  const authError = await legacyOdooRouteGuard(request, { administrator: true });
  if (authError) return authError;
  const { searchParams } = new URL(request.url);
  const orderId = parseInt(searchParams.get('orderId') || '0', 10);
  const invoiceId = parseInt(searchParams.get('invoiceId') || '0', 10);

  const fields = ['id', 'name', 'mimetype', 'file_size', 'res_model', 'res_id', 'type', 'url'];

  const results: Record<string, unknown> = {};
  let orderInfo: DebugOrder | null = null;

  if (orderId) {
    results.saleOrderAtts = await odooFetch('ir.attachment', 'search_read',
      [['res_model', '=', 'sale.order'], ['res_id', '=', orderId]],
      fields
    ).catch(error => ({ error: errorMessage(error) }));
  }

  if (invoiceId) {
    results.accountMoveAtts = await odooFetch('ir.attachment', 'search_read',
      [['res_model', '=', 'account.move'], ['res_id', '=', invoiceId]],
      fields
    ).catch(error => ({ error: errorMessage(error) }));
  }

  // Also try fetching ALL attachments for the order's invoice_ids from sale.order
  if (orderId) {
    const orders = await odooFetch<DebugOrder[]>('sale.order', 'search_read',
      [['id', '=', orderId]],
      ['id', 'name', 'invoice_ids']
    ).catch(() => []);

    orderInfo = orders[0] ?? null;
    results.orderInfo = orderInfo;

    const invoiceIds: number[] = orders[0]?.invoice_ids ?? [];
    if (invoiceIds.length > 0) {
      results.allInvoiceAtts = await odooFetch('ir.attachment', 'search_read',
        [['res_model', '=', 'account.move'], ['res_id', 'in', invoiceIds]],
        fields
      ).catch(error => ({ error: errorMessage(error) }));
    }
  }

  // Try to find available report actions for account.move
  results.reportActions = await odooFetch('ir.actions.report', 'search_read',
    [['model', '=', 'account.move']],
    ['id', 'name', 'report_name', 'report_type']
  ).catch(error => ({ error: errorMessage(error) }));

  // Test _render and other underscore methods via JSON/2
  const { baseUrl, apiKey } = getOdooConfig();
  if (invoiceId || (orderId && orderInfo && orderInfo.invoice_ids.length > 0)) {
    const invId = invoiceId || orderInfo!.invoice_ids[0];

    const post = async (path: string, body: object) => {
      const r = await fetch(`${baseUrl}/${path}`, {
        method: 'POST',
        headers: { 'Authorization': `bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const ct = r.headers.get('content-type') ?? '';
      if (ct.includes('pdf')) return { status: r.status, ct, body: '(PDF OK)' };
      return { status: r.status, ct, body: (await r.text()).slice(0, 300) };
    };

    // Try _render (public in Odoo 19 via api.model decorator)
    results.try__render = await post('ir.actions.report/_render', {
      report_ref: 'account.report_invoice_with_payments',
      res_ids: [invId],
      data: {},
    }).catch(errorMessage);

    // Try with report_name instead of report_ref
    results.try__render_name = await post('ir.actions.report/_render', {
      report_name: 'account.report_invoice_with_payments',
      res_ids: [invId],
    }).catch(errorMessage);

    // Try _render_qweb_pdf
    results.try__render_qweb_pdf = await post('ir.actions.report/_render_qweb_pdf', {
      report_ref: 'account.report_invoice_with_payments',
      res_ids: [invId],
    }).catch(errorMessage);

    // Try on account.move directly
    results.try_move__get_report = await post('account.move/_get_report_base_filename', {
      domain: [['id', '=', invId]],
      fields: ['id'],
    }).catch(errorMessage);

    // Try the report action by ID (220)
    results.try_report_by_id = await post('ir.actions.report/_render', {
      report_ref: 220,
      res_ids: [invId],
    }).catch(errorMessage);
  }

  return NextResponse.json(results, { status: 200 });
}
