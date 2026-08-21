import { NextRequest, NextResponse } from 'next/server';
import { getSalesOrders } from '@/lib/odoo/services';
import { OdooConfigurationError, OdooApiError } from '@/lib/odoo/client';
import { legacyOdooRouteGuard } from '@/lib/auth/api-auth';

export async function GET(request: NextRequest) {
  const authError = await legacyOdooRouteGuard(request);
  if (authError) return authError;
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || undefined;
  const invoiceStatus = searchParams.get('invoiceStatus') || undefined;
  const orderStatus = searchParams.get('orderStatus') || undefined;

  try {
    const orders = await getSalesOrders({ search, invoiceStatus, orderStatus });
    return NextResponse.json({ orders });
  } catch (error: unknown) {
    console.error('Error fetching sales orders:', error);
    
    if (error instanceof OdooConfigurationError) {
      return NextResponse.json(
        { 
          error: 'CONFIGURATION_ERROR', 
          message: error.message 
        },
        { status: 500 }
      );
    }
    
    if (error instanceof OdooApiError) {
      return NextResponse.json(
        { 
          error: 'API_ERROR', 
          message: error.message,
          code: error.code,
          data: error.data
        },
        { status: error.code === 429 ? 429 : 500 }
      );
    }

    return NextResponse.json(
      { 
        error: 'INTERNAL_SERVER_ERROR', 
        message: error instanceof Error
          ? error.message
          : 'An unexpected error occurred while communicating with Odoo.'
      },
      { status: 500 }
    );
  }
}
